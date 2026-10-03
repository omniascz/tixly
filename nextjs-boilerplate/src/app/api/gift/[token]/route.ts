import { randomBytes, randomUUID } from 'crypto';
import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { db, runWithServiceContext } from '@/lib/db/rls-pool';
import { encryptSecret } from '@/lib/crypto';

interface GiftClaimRow {
  id: string;
  claim_token: string;
  order_id: string;
  recipient_email: string;
  recipient_name: string | null;
  gift_message: string | null;
  event_id: string;
  ticket_type_id: string | null;
  production_id: string | null;
  claimed_at: string | null;
  expires_at: string;
  event_title: string;
  event_date_start: string;
  buyer_name: string;
  order_status: string;
}

interface EventOptionRow {
  id: string;
  title: string;
  date_start: string;
  remaining_qty: number;
}

export async function GET(
  _req: NextRequest,
  { params }: { params: { token: string } },
): Promise<Response> {
  return runWithServiceContext(async () => {
    const token = params.token;
    if (!token || token.length < 10) {
      return NextResponse.json({ error: 'Invalid token' }, { status: 400 });
    }

    const r = await db().query<GiftClaimRow>(
      `SELECT gc.id, gc.claim_token, gc.order_id,
              gc.recipient_email, gc.recipient_name, gc.gift_message,
              gc.event_id, gc.ticket_type_id, gc.production_id,
              gc.claimed_at::text, gc.expires_at::text,
              e.title AS event_title,
              e.date_start::text AS event_date_start,
              u.name AS buyer_name, -- kolo 4: bez fallbacku na e-mail dárce
              o.status AS order_status
         FROM orders.gift_claims gc
         JOIN catalog.events e ON e.id = gc.event_id
         JOIN orders.orders o ON o.id = gc.order_id
         JOIN identity.users u ON u.id = o.user_id
        WHERE gc.claim_token = $1
          AND gc.expires_at > NOW()`,
      [token],
    );

    if (r.rows.length === 0) {
      return NextResponse.json({ error: 'GIFT_NOT_FOUND' }, { status: 404 });
    }

    const gc = r.rows[0];

    if (gc.claimed_at) {
      return NextResponse.json({ error: 'ALREADY_CLAIMED' }, { status: 409 });
    }

    if (gc.order_status !== 'paid' && gc.order_status !== 'paid_partial') {
      return NextResponse.json(
        { error: 'ORDER_NOT_PAID', orderStatus: gc.order_status },
        { status: 402 },
      );
    }

    let options: EventOptionRow[] = [];
    if (gc.production_id) {
      const evRes = await db().query<EventOptionRow>(
        `SELECT e.id, e.title, e.date_start::text AS date_start,
                COALESCE(
                  (SELECT SUM(tt.remaining_qty) FROM catalog.ticket_types tt WHERE tt.event_id = e.id),
                  0
                )::int AS remaining_qty
           FROM catalog.events e
          WHERE e.production_id = $1
            AND e.date_start > NOW()
            AND e.status = 'published'
          ORDER BY e.date_start ASC`,
        [gc.production_id],
      );
      options = evRes.rows.filter((ev) => ev.remaining_qty > 0);
    }

    return NextResponse.json({
      gift: {
        recipientName: gc.recipient_name,
        giftMessage: gc.gift_message,
        fromName: gc.buyer_name,
        eventTitle: gc.event_title,
        eventDateStart: gc.event_date_start,
        expiresAt: gc.expires_at,
        hasChoice: gc.production_id !== null,
        options: options.map((ev) => ({
          id: ev.id,
          title: ev.title,
          dateStart: ev.date_start,
          remainingQty: ev.remaining_qty,
        })),
      },
    });
  });
}

const postSchema = z.object({
  selectedEventId: z.string().uuid(),
  selectedSeatId: z.string().uuid().optional(),
});

export async function POST(
  req: NextRequest,
  { params }: { params: { token: string } },
): Promise<Response> {
  return runWithServiceContext(async () => {
    const token = params.token;
    const body: unknown = await req.json().catch(() => null);
    const parsed = postSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ error: 'Validation failed', issues: parsed.error.issues }, { status: 422 });
    }
    const { selectedEventId, selectedSeatId } = parsed.data;

    const client = await db().connect();
    try {
      await client.query('BEGIN');

      const gcRes = await client.query<{
        id: string;
        order_id: string;
        recipient_email: string;
        recipient_name: string | null;
        event_id: string;
        ticket_type_id: string | null;
        production_id: string | null;
        claimed_at: string | null;
        expires_at: string;
        order_status: string;
      }>(
        `SELECT gc.id, gc.order_id, gc.recipient_email, gc.recipient_name,
                gc.event_id, gc.ticket_type_id, gc.production_id,
                gc.claimed_at::text, gc.expires_at::text,
                o.status AS order_status
           FROM orders.gift_claims gc
           JOIN orders.orders o ON o.id = gc.order_id
          WHERE gc.claim_token = $1
          FOR UPDATE OF gc`,
        [token],
      );

      if (gcRes.rows.length === 0) {
        await client.query('ROLLBACK');
        return NextResponse.json({ error: 'GIFT_NOT_FOUND' }, { status: 404 });
      }

      const gc = gcRes.rows[0];

      if (gc.claimed_at) {
        await client.query('ROLLBACK');
        return NextResponse.json({ error: 'ALREADY_CLAIMED' }, { status: 409 });
      }
      if (new Date(gc.expires_at).getTime() < Date.now()) {
        await client.query('ROLLBACK');
        return NextResponse.json({ error: 'GIFT_EXPIRED' }, { status: 410 });
      }
      if (gc.order_status !== 'paid' && gc.order_status !== 'paid_partial') {
        await client.query('ROLLBACK');
        return NextResponse.json({ error: 'ORDER_NOT_PAID' }, { status: 402 });
      }

      // Ověř event patří k produkci (pokud je production_id nastaveno) nebo je přímo ten event
      if (gc.production_id) {
        const evCheck = await client.query<{ id: string }>(
          `SELECT id FROM catalog.events WHERE id = $1 AND production_id = $2 AND status = 'published'`,
          [selectedEventId, gc.production_id],
        );
        if (evCheck.rows.length === 0) {
          await client.query('ROLLBACK');
          return NextResponse.json({ error: 'EVENT_NOT_IN_PRODUCTION' }, { status: 422 });
        }
      } else {
        if (selectedEventId !== gc.event_id) {
          await client.query('ROLLBACK');
          return NextResponse.json({ error: 'EVENT_MISMATCH' }, { status: 422 });
        }
      }

      // Najdi ticket_type pro selectedEventId (buď z gc.ticket_type_id nebo první dostupný)
      let ticketTypeId = gc.ticket_type_id;
      if (!ticketTypeId || gc.production_id) {
        const ttRes = await client.query<{ id: string }>(
          `SELECT tt.id FROM catalog.ticket_types tt
            WHERE tt.event_id = $1 AND tt.remaining_qty > 0
            -- T4: catalog.ticket_types NEMA sort_order (ani jiny radici sloupec) —
            -- overeno introspekci, ne odhadem. ORDER BY na nem koncil 42703 a routa
            -- (verejne uplatneni darkoveho poukazu) padala. Radi se cenou.
            ORDER BY tt.base_price ASC
            LIMIT 1`,
          [selectedEventId],
        );
        if (ttRes.rows.length === 0) {
          await client.query('ROLLBACK');
          return NextResponse.json({ error: 'NO_TICKETS_AVAILABLE' }, { status: 409 });
        }
        ticketTypeId = ttRes.rows[0].id;
      }

      // Atomický decrement remaining_qty
      const reserve = await client.query(
        `UPDATE catalog.ticket_types
            SET remaining_qty = remaining_qty - 1
          WHERE id = $1 AND remaining_qty >= 1
          RETURNING remaining_qty`,
        [ticketTypeId],
      );
      if (reserve.rowCount === 0) {
        await client.query('ROLLBACK');
        return NextResponse.json({ error: 'NO_TICKETS_AVAILABLE' }, { status: 409 });
      }

      // Najdi nebo založ recipient usera
      const userRes = await client.query<{ id: string }>(
        `INSERT INTO identity.users (email, name, password_hash, gdpr_consent_at, created_at, updated_at)
         VALUES ($1, $2, '!gift_recipient', NOW(), NOW(), NOW())
         ON CONFLICT (email) WHERE anonymized_at IS NULL DO UPDATE SET updated_at = NOW()
         RETURNING id`,
        [gc.recipient_email, gc.recipient_name ?? gc.recipient_email],
      );
      const recipientUserId = userRes.rows[0].id;

      // Vydej vstupenku pro příjemce (přímý INSERT bez demo-issuer — order context je jiný event)
      const ticketId = randomUUID();
      const totpSecretRaw = randomBytes(20);
      const encryptedBundle = Buffer.from(
        encryptSecret(totpSecretRaw.toString('base64')),
        'base64',
      );

      // Zjisti original_price z ticket_type
      const priceRes = await client.query<{ base_price: number }>(
        `SELECT base_price FROM catalog.ticket_types WHERE id = $1`,
        [ticketTypeId],
      );
      const originalPrice = priceRes.rows[0]?.base_price ?? 0;

      await client.query(
        `INSERT INTO tickets.tickets
           (id, order_id, ticket_type_id, owner_id, original_owner_id,
            status, totp_secret_encrypted, totp_secret_iv, original_price, event_seat_id)
         VALUES ($1, $2, $3, $4, $4, 'valid', $5, $6, $7, $8)`,
        [
          ticketId,
          gc.order_id,
          ticketTypeId,
          recipientUserId,
          encryptedBundle,
          Buffer.alloc(0),
          originalPrice,
          selectedSeatId ?? null,
        ],
      );

      // Načti event detail pro response
      const eventRes = await client.query<{ title: string; date_start: string }>(
        `SELECT title, date_start::text AS date_start FROM catalog.events WHERE id = $1`,
        [selectedEventId],
      );
      const eventTitle = eventRes.rows[0]?.title ?? '';
      const eventDate = eventRes.rows[0]?.date_start ?? '';

      // Ulož výsledek do gift_claim
      await client.query(
        `UPDATE orders.gift_claims
            SET claimed_at = NOW(),
                claimed_event_id = $2,
                claimed_ticket_id = $3
          WHERE id = $1`,
        [gc.id, selectedEventId, ticketId],
      );

      await client.query('COMMIT');

      // QR payload: totpauth URI (jako v buyer/my-tickets)
      const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
      let bits = 0;
      let value = 0;
      let base32 = '';
      for (let i = 0; i < totpSecretRaw.length; i++) {
        value = (value << 8) | totpSecretRaw[i];
        bits += 8;
        while (bits >= 5) {
          base32 += alphabet[(value >>> (bits - 5)) & 31];
          bits -= 5;
        }
      }
      if (bits > 0) base32 += alphabet[(value << (5 - bits)) & 31];

      const qrPayload = `otpauth://totp/${encodeURIComponent(eventTitle)}?secret=${base32}&issuer=Tixly`;

      return NextResponse.json({
        ticket: {
          id: ticketId,
          eventTitle,
          eventDate,
        },
        qrPayload,
      });
    } catch (err) {
      await client.query('ROLLBACK');
      console.error('[gift claim]', err);
      return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
    } finally {
      client.release();
    }
  });
}
