/**
 * GET  /api/charity/claim/[token] — beneficiary vidí preview eventu
 * POST /api/charity/claim/[token]  body: { email, name? } — claimne ticket
 *
 * Po claim se vytvoří order s payment_provider='charity', total_amount=0,
 * pak issue ticket přes existující demo-issuer.
 *
 * Public — žádná auth, kdokoliv s tokenem může claimnout.
 */
import { NextRequest, NextResponse } from 'next/server';
import { db, runWithServiceContext } from '@/lib/db/rls-pool';
import { randomUUID } from 'crypto';
import { z } from 'zod';


export async function GET(
  _req: NextRequest,
  { params }: { params: { token: string } },
): Promise<Response> {
  return runWithServiceContext(async () => {

  if (!/^[A-Za-z0-9_-]{20,80}$/.test(params.token)) {
    return NextResponse.json({ error: 'INVALID_TOKEN' }, { status: 400 });
  }

  const client = await db().connect();
  try {
    await client.query('BEGIN');
    // Kolo 3: servisní kontext (runWithServiceContext) stačí — politiky mají větev app_is_service(); admin eskalace odstraněna.

    const r = await client.query<{
      slot_id: string;
      status: string;
      expires_at: string;
      event_id: string;
      event_title: string;
      event_date_start: string;
      charity_name: string;
      message: string | null;
    }>(
      `SELECT s.id AS slot_id, s.status, s.expires_at::text,
              a.event_id, e.title AS event_title,
              e.date_start::text AS event_date_start,
              c.name AS charity_name, a.message
         FROM charity.claim_slots s
         JOIN charity.allocations a ON a.id = s.allocation_id
         JOIN catalog.events e ON e.id = a.event_id
         JOIN charity.partners c ON c.id = a.charity_id
        WHERE s.claim_token = $1`,
      [params.token],
    );

    await client.query('COMMIT');

    if (r.rows.length === 0) {
      return NextResponse.json({ error: 'NOT_FOUND' }, { status: 404 });
    }
    const s = r.rows[0];
    return NextResponse.json({
      status: s.status,
      expired: new Date(s.expires_at).getTime() < Date.now(),
      event: {
        id: s.event_id,
        title: s.event_title,
        dateStart: s.event_date_start,
      },
      charityName: s.charity_name,
      message: s.message,
      expiresAt: s.expires_at,
    });
  } catch (err) {
    await client.query('ROLLBACK').catch(() => undefined);
    console.error('[GET /api/charity/claim/[token]]', err);
    return NextResponse.json({ error: 'INTERNAL' }, { status: 500 });
  } finally {
    client.release();
  }

  });
}

const claimSchema = z.object({
  email: z.string().email().max(200),
  name: z.string().min(1).max(120).optional(),
});

export async function POST(
  req: NextRequest,
  { params }: { params: { token: string } },
): Promise<Response> {
  return runWithServiceContext(async () => {

  if (!/^[A-Za-z0-9_-]{20,80}$/.test(params.token)) {
    return NextResponse.json({ error: 'INVALID_TOKEN' }, { status: 400 });
  }
  const body: unknown = await req.json().catch(() => ({}));
  const parsed = claimSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'INVALID_BODY', issues: parsed.error.issues },
      { status: 422 },
    );
  }

  const client = await db().connect();
  try {
    await client.query('BEGIN');
    // Kolo 3: servisní kontext (runWithServiceContext) stačí — politiky mají větev app_is_service(); admin eskalace odstraněna.

    const slot = await client.query<{
      id: string;
      status: string;
      expires_at: string;
      allocation_id: string;
      event_id: string;
      ticket_type_id: string | null;
    }>(
      `SELECT s.id, s.status, s.expires_at,
              s.allocation_id, a.event_id, a.ticket_type_id
         FROM charity.claim_slots s
         JOIN charity.allocations a ON a.id = s.allocation_id
        WHERE s.claim_token = $1
        FOR UPDATE OF s`,
      [params.token],
    );
    if (slot.rows.length === 0) {
      await client.query('ROLLBACK');
      return NextResponse.json({ error: 'NOT_FOUND' }, { status: 404 });
    }
    const s = slot.rows[0];
    if (s.status !== 'available') {
      await client.query('ROLLBACK');
      return NextResponse.json(
        { error: 'ALREADY_RESOLVED', status: s.status },
        { status: 410 },
      );
    }
    if (new Date(s.expires_at).getTime() < Date.now()) {
      await client.query('ROLLBACK');
      return NextResponse.json({ error: 'EXPIRED' }, { status: 410 });
    }

    // Resolve user — najdi nebo vytvoř guest user (žádné heslo, identifikuje
    // se přes email + ticket QR).
    let userId: string;
    const u = await client.query<{ id: string }>(
      `SELECT id FROM identity.users WHERE email = $1`,
      [parsed.data.email.toLowerCase()],
    );
    if (u.rows.length > 0) {
      userId = u.rows[0].id;
    } else {
      // password_hash NOT NULL — guest user, nemůže se přihlásit, hash je
      // permanentně neplatný (žádné platné heslo se nehashne na 'charity-guest')
      const newUser = await client.query<{ id: string }>(
        `INSERT INTO identity.users (email, name, password_hash, gdpr_consent_at)
         VALUES ($1, $2, 'charity-guest-no-login', NOW())
         RETURNING id`,
        [parsed.data.email.toLowerCase(), parsed.data.name ?? null],
      );
      userId = newUser.rows[0].id;
    }

    // Default ticket_type_id když není specified — nejlevnější ticket type
    // pro event (charity dostává standardní místa, ne VIP).
    let ttId = s.ticket_type_id;
    if (!ttId) {
      const tt = await client.query<{ id: string }>(
        `SELECT id FROM catalog.ticket_types
          WHERE event_id = $1 ORDER BY base_price LIMIT 1`,
        [s.event_id],
      );
      if (tt.rows.length === 0) {
        await client.query('ROLLBACK');
        return NextResponse.json(
          { error: 'NO_TICKET_TYPE_AVAILABLE' },
          { status: 409 },
        );
      }
      ttId = tt.rows[0].id;
    }
    // Event-level currency (ticket_types nemá currency column, je na events)
    const evCur = await client.query<{ currency: string }>(
      `SELECT currency FROM catalog.events WHERE id = $1`,
      [s.event_id],
    );
    const currency = evCur.rows[0]?.currency ?? 'CZK';

    // Vytvoř order — provider=charity, paid status, amount=0
    const order = await client.query<{ id: string }>(
      `INSERT INTO orders.orders
         (user_id, event_id, status, total_amount, currency, locale,
          gopay_payment_id, payment_provider, idempotency_key,
          expires_at, created_at, updated_at)
       VALUES ($1, $2, 'paid', 0, $3, 'cs',
               $4, 'charity', $5,
               NOW() + INTERVAL '7 days', NOW(), NOW())
       RETURNING id`,
      [
        userId,
        s.event_id,
        currency,
        `charity-${randomUUID().slice(0, 8)}`,
        randomUUID(),
      ],
    );
    const orderId = order.rows[0].id;

    await client.query(
      `INSERT INTO orders.order_items
         (order_id, ticket_type_id, quantity, unit_price, total_price)
       VALUES ($1, $2, 1, 0, 0)`,
      [orderId, ttId],
    );

    await client.query(
      `UPDATE charity.claim_slots
          SET status = 'claimed',
              claimed_by_email = $2,
              claimed_by_name = $3,
              order_id = $4,
              claimed_at = NOW()
        WHERE id = $1`,
      [s.id, parsed.data.email.toLowerCase(), parsed.data.name ?? null, orderId],
    );

    await client.query('COMMIT');

    // Issue ticket fire-and-forget (mimo transakci, RLS bypass v issuer)
    void (async () => {
      try {
        const { issueTicketsForOrder } = await import('@/lib/tickets/demo-issuer');
        await issueTicketsForOrder(orderId, db());
      } catch (err) {
        console.error('[charity claim] issueTickets failed', err);
      }
    })();

    return NextResponse.json({
      ok: true,
      orderId,
      ticketTypeId: ttId,
      message: 'Ticket vystaven. Email s QR pošleme do několika sekund.',
    });
  } catch (err) {
    await client.query('ROLLBACK').catch(() => undefined);
    console.error('[POST /api/charity/claim/[token]]', err);
    return NextResponse.json({ error: 'INTERNAL' }, { status: 500 });
  } finally {
    client.release();
  }

  });
}
