import { randomBytes, randomUUID } from 'crypto';
import { NextRequest, NextResponse } from 'next/server';
import { db, runWithServiceContext } from '@/lib/db/rls-pool';
import { z } from 'zod';
import { encryptSecret } from '@/lib/crypto';
import { saleBlockedResponse } from '@/lib/sales/cutoff';

interface PassRow {
  id: string;
  product_id: string;
  holder_email: string;
  holder_name: string | null;
  uses_remaining: number;
  valid_until: string;
  status: string;
  product_title: string;
  total_uses: number;
  promoter_id: string;
  promoter_name: string;
  promoter_slug: string;
}

interface UseRow {
  id: string;
  event_id: string;
  used_at: string;
  event_title: string;
  event_date: string;
}

export async function GET(
  _req: NextRequest,
  { params }: { params: { passToken: string } },
): Promise<Response> {
  return runWithServiceContext(async () => {
    const { passToken } = params;

    const passRes = await db().query<PassRow>(
      `SELECT sp.id, sp.product_id, sp.holder_email, sp.holder_name,
              sp.uses_remaining, sp.valid_until::text, sp.status,
              spp.title AS product_title, spp.total_uses,
              p.id AS promoter_id, p.name AS promoter_name, p.slug AS promoter_slug
       FROM orders.season_passes sp
       JOIN catalog.season_pass_products spp ON spp.id = sp.product_id
       JOIN platform.promoters p ON p.id = spp.promoter_id
       WHERE sp.pass_token = $1`,
      [passToken],
    );
    if (passRes.rows.length === 0) {
      return NextResponse.json({ error: 'PASS_NOT_FOUND' }, { status: 404 });
    }
    const pass = passRes.rows[0];

    const usesRes = await db().query<UseRow>(
      `SELECT spu.id, spu.event_id, spu.used_at::text,
              e.title AS event_title, e.date_start::text AS event_date
       FROM orders.season_pass_uses spu
       JOIN catalog.events e ON e.id = spu.event_id
       WHERE spu.pass_id = $1
       ORDER BY spu.used_at DESC`,
      [pass.id],
    );

    const upcomingRes = await db().query<{ id: string; title: string; date_start: string }>(
      `SELECT e.id, e.title, e.date_start::text
       FROM catalog.events e
       WHERE e.promoter_id = $1
         AND e.status = 'published'
         AND e.date_start > NOW()
       ORDER BY e.date_start ASC
       LIMIT 20`,
      [pass.promoter_id],
    );

    return NextResponse.json({
      pass: {
        id: pass.id,
        holderEmail: pass.holder_email,
        holderName: pass.holder_name,
        usesRemaining: pass.uses_remaining,
        totalUses: pass.total_uses,
        validUntil: pass.valid_until,
        status: pass.status,
        productTitle: pass.product_title,
        promoterName: pass.promoter_name,
        promoterSlug: pass.promoter_slug,
      },
      uses: usesRes.rows.map((u) => ({
        id: u.id,
        eventId: u.event_id,
        eventTitle: u.event_title,
        eventDate: u.event_date,
        usedAt: u.used_at,
      })),
      upcomingEvents: upcomingRes.rows.map((e) => ({
        id: e.id,
        title: e.title,
        dateStart: e.date_start,
      })),
    });
  });
}

const useSchema = z.object({ eventId: z.string().uuid() });

export async function POST(
  req: NextRequest,
  { params }: { params: { passToken: string } },
): Promise<Response> {
  return runWithServiceContext(async () => {
    const { passToken } = params;
    const body: unknown = await req.json().catch(() => ({}));
    const parsed = useSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ error: 'INVALID_BODY', issues: parsed.error.issues }, { status: 422 });
    }
    const { eventId } = parsed.data;
    // Kolo 7 (C-29): uplatnění pasu na akci po uzávěrce online prodeje nejde.
    const salesClosed = await saleBlockedResponse(db(), eventId, 'online');
    if (salesClosed) return salesClosed;

    const client = await db().connect();
    try {
      await client.query('BEGIN');

      const passRes = await client.query<{
        id: string;
        holder_user_id: string;
        holder_email: string;
        uses_remaining: number;
        valid_until: string;
        status: string;
        product_id: string;
      }>(
        `SELECT id, holder_user_id, holder_email, uses_remaining, valid_until, status, product_id
         FROM orders.season_passes
         WHERE pass_token = $1
         FOR UPDATE`,
        [passToken],
      );
      if (passRes.rows.length === 0) {
        await client.query('ROLLBACK');
        return NextResponse.json({ error: 'PASS_NOT_FOUND' }, { status: 404 });
      }
      const pass = passRes.rows[0];

      if (pass.status !== 'active') {
        await client.query('ROLLBACK');
        return NextResponse.json({ error: 'PASS_NOT_ACTIVE', status: pass.status }, { status: 409 });
      }
      if (pass.uses_remaining <= 0) {
        await client.query('ROLLBACK');
        return NextResponse.json({ error: 'NO_USES_REMAINING' }, { status: 409 });
      }
      if (new Date(pass.valid_until).getTime() < Date.now()) {
        await client.query('ROLLBACK');
        return NextResponse.json({ error: 'PASS_EXPIRED' }, { status: 409 });
      }

      const eventRes = await client.query<{
        id: string;
        title: string;
        date_start: string;
        promoter_id: string;
        currency: string;
      }>(
        `SELECT e.id, e.title, e.date_start, e.promoter_id, COALESCE(e.currency, 'CZK') AS currency
         FROM catalog.events e
         WHERE e.id = $1 AND e.status = 'published'`,
        [eventId],
      );
      if (eventRes.rows.length === 0) {
        await client.query('ROLLBACK');
        return NextResponse.json({ error: 'EVENT_NOT_FOUND' }, { status: 404 });
      }
      const event = eventRes.rows[0];
      if (new Date(event.date_start).getTime() < Date.now()) {
        await client.query('ROLLBACK');
        return NextResponse.json({ error: 'EVENT_PAST' }, { status: 409 });
      }

      const ttRes = await client.query<{ id: string }>(
        `SELECT tt.id
         FROM catalog.ticket_types tt
         WHERE tt.event_id = $1
           AND (tt.kind = 'accreditation' OR tt.base_price = 0)
           AND tt.remaining_qty > 0
         ORDER BY tt.kind = 'accreditation' DESC, tt.created_at ASC
         LIMIT 1
         FOR UPDATE`,
        [eventId],
      );
      if (ttRes.rows.length === 0) {
        await client.query('ROLLBACK');
        return NextResponse.json({ error: 'NO_COMP_TICKET_TYPE' }, { status: 409 });
      }
      const ttId = ttRes.rows[0].id;

      const orderId = randomUUID();
      await client.query(
        `INSERT INTO orders.orders
           (id, user_id, event_id, status, total_amount, currency, locale,
            gopay_payment_id, payment_provider, idempotency_key,
            discount_halire, service_fee_minor, requires_age_verification, paid_at,
            expires_at, created_at, updated_at)
         VALUES ($1, $2, $3, 'paid', 0, $4, 'cs',
                 $5, 'free', $6,
                 0, 0, FALSE, NOW(),
                 NOW() + INTERVAL '1 day', NOW(), NOW())`,
        [
          orderId,
          pass.holder_user_id,
          eventId,
          event.currency,
          `sp-${pass.id.slice(0, 8)}`,
          randomUUID(),
        ],
      );

      await client.query(
        `INSERT INTO orders.order_items
           (order_id, ticket_type_id, quantity, unit_price, total_price)
         VALUES ($1, $2, 1, 0, 0)`,
        [orderId, ttId],
      );

      const ticketId = randomUUID();
      const totpRaw = randomBytes(20);
      const encryptedBundle = Buffer.from(
        encryptSecret(totpRaw.toString('base64')),
        'base64',
      );

      await client.query(
        `INSERT INTO tickets.tickets
           (id, order_id, ticket_type_id, owner_id, original_owner_id,
            status, totp_secret_encrypted, totp_secret_iv, original_price)
         VALUES ($1, $2, $3, $4, $4, 'valid', $5, $6, 0)`,
        [ticketId, orderId, ttId, pass.holder_user_id, encryptedBundle, Buffer.alloc(0)],
      );

      await client.query(
        `UPDATE catalog.ticket_types SET remaining_qty = remaining_qty - 1 WHERE id = $1`,
        [ttId],
      );

      await client.query(
        `UPDATE orders.season_passes
         SET uses_remaining = uses_remaining - 1
         WHERE id = $1`,
        [pass.id],
      );

      const useRes = await client.query<{ id: string }>(
        `INSERT INTO orders.season_pass_uses (pass_id, event_id, ticket_id)
         VALUES ($1, $2, $3)
         RETURNING id`,
        [pass.id, eventId, ticketId],
      );

      await client.query('COMMIT');

      return NextResponse.json({
        useId: useRes.rows[0].id,
        ticketId,
        orderId,
        eventTitle: event.title,
        usesRemaining: pass.uses_remaining - 1,
      });
    } catch (err) {
      await client.query('ROLLBACK');
      console.error('[POST /api/season-passes/[passToken]]', err);
      return NextResponse.json({ error: 'INTERNAL' }, { status: 500 });
    } finally {
      client.release();
    }
  });
}
