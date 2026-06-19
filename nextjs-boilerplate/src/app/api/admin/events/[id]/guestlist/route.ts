import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db/rls-pool';
import { runAsActivePromoter } from '@/lib/admin-auth';
import { issueTicketsForOrder } from '@/lib/tickets/demo-issuer';
import { z } from 'zod';
import { randomUUID } from 'crypto';

const postSchema = z.object({
  guestName: z.string().min(1).max(200),
  guestEmail: z.string().email().max(200),
  notes: z.string().max(1000).optional(),
  invitedBy: z.string().max(200).optional(),
});

const deleteSchema = z.object({
  entryId: z.string().uuid(),
});

const patchSchema = z.object({
  entryId: z.string().uuid(),
  status: z.enum(['invited', 'confirmed', 'attended', 'no_show', 'cancelled']),
});

async function ownsEvent(eventId: string, promoterId: string): Promise<boolean> {
  if (!/^[0-9a-f-]{36}$/i.test(eventId)) return false;
  const r = await db().query<{ count: string }>(
    `SELECT COUNT(*)::text AS count FROM catalog.events
     WHERE id = $1 AND promoter_id = $2`,
    [eventId, promoterId],
  );
  return Number(r.rows[0]?.count ?? 0) > 0;
}

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  return runAsActivePromoter(req, async (promoter) => {
    const { id: eventId } = await params;
    if (!(await ownsEvent(eventId, promoter.promoterId))) {
      return NextResponse.json({ error: 'FORBIDDEN' }, { status: 403 });
    }

    const r = await db().query<{
      id: string;
      guest_name: string;
      guest_email: string;
      notes: string | null;
      invited_by: string | null;
      status: string;
      ticket_id: string | null;
      order_id: string | null;
      checked_in_at: string | null;
      created_at: string;
    }>(
      `SELECT id, guest_name, guest_email, notes, invited_by, status,
              ticket_id, order_id, checked_in_at, created_at
       FROM orders.guestlist_entries
       WHERE event_id = $1
       ORDER BY guest_name`,
      [eventId],
    );

    const capacityRes = await db().query<{
      total_capacity: string | null;
    }>(
      `SELECT SUM(total_qty) AS total_capacity
       FROM catalog.ticket_types
       WHERE event_id = $1`,
      [eventId],
    );

    return NextResponse.json({
      entries: r.rows,
      totalGuests: r.rows.filter((e) => e.status !== 'cancelled').length,
      capacity: capacityRes.rows[0]?.total_capacity
        ? Number(capacityRes.rows[0].total_capacity)
        : null,
    });
  });
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  return runAsActivePromoter(req, async (promoter) => {
    const { id: eventId } = await params;
    if (!(await ownsEvent(eventId, promoter.promoterId))) {
      return NextResponse.json({ error: 'FORBIDDEN' }, { status: 403 });
    }

    const body: unknown = await req.json().catch(() => ({}));
    const parsed = postSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ error: 'INVALID_BODY', issues: parsed.error.issues }, { status: 422 });
    }

    const client = await db().connect();
    try {
      await client.query('BEGIN');

      const ttRes = await client.query<{ id: string; currency: string }>(
        `SELECT id, currency FROM catalog.ticket_types
         WHERE event_id = $1 AND is_published = TRUE
         ORDER BY sort_order, created_at
         LIMIT 1`,
        [eventId],
      );
      if (ttRes.rows.length === 0) {
        await client.query('ROLLBACK');
        return NextResponse.json(
          { error: 'NO_TICKET_TYPE', message: 'Akce nemá žádný aktivní typ vstupenky.' },
          { status: 422 },
        );
      }
      const tt = ttRes.rows[0];

      const userRes = await client.query<{ id: string }>(
        `INSERT INTO identity.users (email, name, password_hash, status)
         VALUES (LOWER($1), $2, '', 'active')
         ON CONFLICT (email) DO UPDATE SET updated_at = NOW()
         RETURNING id`,
        [parsed.data.guestEmail, parsed.data.guestName],
      );
      const userId = userRes.rows[0].id;

      const orderId = randomUUID();
      await client.query(
        `INSERT INTO orders.orders
           (id, user_id, event_id, status, total_amount, currency, locale,
            gopay_payment_id, payment_provider, idempotency_key,
            discount_halire, requires_age_verification, paid_at,
            expires_at, created_at, updated_at)
         VALUES ($1, $2, $3, 'paid', 0, $4, 'cs',
                 $5, 'free', $6,
                 0, FALSE, NOW(),
                 NOW() + INTERVAL '1 day', NOW(), NOW())`,
        [
          orderId,
          userId,
          eventId,
          tt.currency,
          `guest-${randomUUID().slice(0, 8)}`,
          randomUUID(),
        ],
      );

      await client.query(
        `INSERT INTO orders.order_items
           (order_id, ticket_type_id, quantity, unit_price, total_price)
         VALUES ($1, $2, 1, 0, 0)`,
        [orderId, tt.id],
      );

      const tickets = await issueTicketsForOrder(orderId, client);
      const ticketId = tickets[0]?.ticketId ?? null;

      const entryRes = await client.query<{
        id: string;
        guest_name: string;
        guest_email: string;
        notes: string | null;
        invited_by: string | null;
        status: string;
        ticket_id: string | null;
        order_id: string | null;
        checked_in_at: string | null;
        created_at: string;
      }>(
        `INSERT INTO orders.guestlist_entries
           (event_id, guest_name, guest_email, notes, invited_by, ticket_id, order_id)
         VALUES ($1, $2, $3, $4, $5, $6, $7)
         RETURNING id, guest_name, guest_email, notes, invited_by, status,
                   ticket_id, order_id, checked_in_at, created_at`,
        [
          eventId,
          parsed.data.guestName,
          parsed.data.guestEmail,
          parsed.data.notes ?? null,
          parsed.data.invitedBy ?? null,
          ticketId,
          orderId,
        ],
      );

      await client.query('COMMIT');
      return NextResponse.json({ entry: entryRes.rows[0] }, { status: 201 });
    } catch (err) {
      await client.query('ROLLBACK');
      console.error('[POST guestlist]', err);
      return NextResponse.json({ error: 'INTERNAL_ERROR' }, { status: 500 });
    } finally {
      client.release();
    }
  });
}

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  return runAsActivePromoter(req, async (promoter) => {
    const { id: eventId } = await params;
    if (!(await ownsEvent(eventId, promoter.promoterId))) {
      return NextResponse.json({ error: 'FORBIDDEN' }, { status: 403 });
    }

    const body: unknown = await req.json().catch(() => ({}));
    const parsed = deleteSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ error: 'INVALID_BODY' }, { status: 422 });
    }

    const client = await db().connect();
    try {
      await client.query('BEGIN');

      const entryRes = await client.query<{ ticket_id: string | null; status: string }>(
        `UPDATE orders.guestlist_entries
         SET status = 'cancelled', updated_at = NOW()
         WHERE id = $1 AND event_id = $2 AND status <> 'cancelled'
         RETURNING ticket_id, status`,
        [parsed.data.entryId, eventId],
      );

      if (entryRes.rows.length === 0) {
        await client.query('ROLLBACK');
        return NextResponse.json({ error: 'NOT_FOUND' }, { status: 404 });
      }

      const ticketId = entryRes.rows[0].ticket_id;
      if (ticketId) {
        await client.query(
          `UPDATE tickets.tickets
           SET status = 'cancelled', updated_at = NOW()
           WHERE id = $1 AND status NOT IN ('used', 'cancelled')`,
          [ticketId],
        );
      }

      await client.query('COMMIT');
      return NextResponse.json({ ok: true });
    } catch (err) {
      await client.query('ROLLBACK');
      console.error('[DELETE guestlist]', err);
      return NextResponse.json({ error: 'INTERNAL_ERROR' }, { status: 500 });
    } finally {
      client.release();
    }
  });
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  return runAsActivePromoter(req, async (promoter) => {
    const { id: eventId } = await params;
    if (!(await ownsEvent(eventId, promoter.promoterId))) {
      return NextResponse.json({ error: 'FORBIDDEN' }, { status: 403 });
    }

    const body: unknown = await req.json().catch(() => ({}));
    const parsed = patchSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ error: 'INVALID_BODY' }, { status: 422 });
    }

    const checkinClause =
      parsed.data.status === 'attended'
        ? ', checked_in_at = COALESCE(checked_in_at, NOW())'
        : '';

    const r = await db().query<{ id: string }>(
      `UPDATE orders.guestlist_entries
       SET status = $3, updated_at = NOW()${checkinClause}
       WHERE id = $1 AND event_id = $2
       RETURNING id`,
      [parsed.data.entryId, eventId, parsed.data.status],
    );

    if (r.rows.length === 0) {
      return NextResponse.json({ error: 'NOT_FOUND' }, { status: 404 });
    }

    return NextResponse.json({ ok: true });
  });
}
