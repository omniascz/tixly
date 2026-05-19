/**
 * PATCH /api/admin/refund-requests/[id]
 *
 * Promotér admin schvaluje nebo zamítá žádost o refund.
 *
 * Body: { decision: 'approve' | 'reject', note?: string }
 *
 * Approve → trigger refund flow (stejné SQL kroky jako buyer self-service):
 *   - tickets.status = 'revoked'
 *   - event_seats uvolnit
 *   - ticket_types.remaining_qty restore
 *   - orders.orders.status = 'refunded' (pokud všechny lístky)
 *   - refund_requests.status = 'approved', refunded_halire vyplnit
 *
 * Reject → status = 'rejected', poslat mail kupci s důvodem.
 */

import { NextRequest, NextResponse } from 'next/server';
import { Pool } from 'pg';
import { z } from 'zod';
import { requirePromoter } from '@/lib/admin-auth';

let pool: Pool | null = null;
function db(): Pool {
  if (!pool) pool = new Pool({ connectionString: process.env.DATABASE_URL });
  return pool;
}

const schema = z.object({
  decision: z.enum(['approve', 'reject']),
  note: z.string().max(2000).optional(),
});

export async function PATCH(
  req: NextRequest,
  { params }: { params: { id: string } },
): Promise<Response> {
  const promoter = await requirePromoter(req);
  if (!promoter || promoter.status !== 'active') {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const body = await req.json().catch(() => ({}));
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: 'BAD_INPUT' }, { status: 422 });
  }

  const client = await db().connect();
  try {
    await client.query('BEGIN');

    // Lock request + check ownership
    const rrRes = await client.query<{
      id: string;
      order_id: string;
      user_id: string;
      status: string;
      ticket_ids: string[] | null;
    }>(
      `SELECT id, order_id, user_id, status, ticket_ids
       FROM orders.refund_requests
       WHERE id = $1 AND promoter_id = $2
       FOR UPDATE`,
      [params.id, promoter.promoterId],
    );
    if (rrRes.rows.length === 0) {
      await client.query('ROLLBACK');
      return NextResponse.json({ error: 'NOT_FOUND' }, { status: 404 });
    }
    const rr = rrRes.rows[0];
    if (rr.status !== 'pending') {
      await client.query('ROLLBACK');
      return NextResponse.json(
        { error: 'ALREADY_REVIEWED', currentStatus: rr.status },
        { status: 409 },
      );
    }

    if (parsed.data.decision === 'reject') {
      await client.query(
        `UPDATE orders.refund_requests
         SET status = 'rejected', reviewed_at = NOW(), reviewed_by = $2,
             reviewer_note = $3, updated_at = NOW()
         WHERE id = $1`,
        [rr.id, promoter.userId, parsed.data.note ?? null],
      );

      await client.query(
        `INSERT INTO audit.audit_log
           (schema_name, table_name, record_id, action, actor_id, actor_type, new_values)
         VALUES ('orders', 'refund_requests', $1, 'UPDATE', $2, 'promoter', $3::jsonb)`,
        [
          rr.id,
          promoter.userId,
          JSON.stringify({ decision: 'reject', note: parsed.data.note }),
        ],
      );

      await client.query('COMMIT');
      return NextResponse.json({ ok: true, decision: 'rejected' });
    }

    // APPROVE — provedeme refund (full nebo partial dle ticket_ids)
    let refundedHalire = 0;
    const partial = Array.isArray(rr.ticket_ids) && rr.ticket_ids.length > 0;

    if (partial) {
      const eligRes = await client.query<{ id: string; original_price: number }>(
        `SELECT id, original_price FROM tickets.tickets
         WHERE id = ANY($1::uuid[]) AND order_id = $2 AND status = 'valid'
         FOR UPDATE`,
        [rr.ticket_ids!, rr.order_id],
      );
      const ids = eligRes.rows.map((r) => r.id);
      refundedHalire = eligRes.rows.reduce((s, r) => s + r.original_price, 0);

      if (ids.length > 0) {
        await client.query(
          `UPDATE tickets.tickets SET status = 'revoked', revoked_at = NOW(), updated_at = NOW()
           WHERE id = ANY($1::uuid[])`,
          [ids],
        );
        await client.query(
          `UPDATE catalog.event_seats
             SET status = 'available', order_id = NULL, hold_user_id = NULL, hold_until = NULL,
                 updated_at = NOW()
           WHERE id IN (SELECT event_seat_id FROM tickets.tickets WHERE id = ANY($1::uuid[]) AND event_seat_id IS NOT NULL)`,
          [ids],
        );
        await client.query(
          `UPDATE catalog.ticket_types tt
           SET remaining_qty = remaining_qty + sub.qty
           FROM (
             SELECT ticket_type_id, COUNT(*)::int AS qty
             FROM tickets.tickets
             WHERE id = ANY($1::uuid[])
             GROUP BY ticket_type_id
           ) sub
           WHERE tt.id = sub.ticket_type_id`,
          [ids],
        );
      }
    } else {
      // Full refund
      const orderRes = await client.query<{ total_amount: number }>(
        `SELECT total_amount FROM orders.orders WHERE id = $1`,
        [rr.order_id],
      );
      refundedHalire = orderRes.rows[0]?.total_amount ?? 0;

      await client.query(
        `UPDATE orders.orders SET status = 'refunded', updated_at = NOW() WHERE id = $1`,
        [rr.order_id],
      );
      await client.query(
        `UPDATE tickets.tickets
         SET status = 'revoked', revoked_at = NOW(), updated_at = NOW()
         WHERE order_id = $1 AND status <> 'revoked'`,
        [rr.order_id],
      );
      await client.query(
        `UPDATE catalog.event_seats
         SET status = 'available', order_id = NULL, hold_user_id = NULL,
             hold_until = NULL, updated_at = NOW()
         WHERE order_id = $1`,
        [rr.order_id],
      );
      await client.query(
        `UPDATE catalog.ticket_types tt
         SET remaining_qty = remaining_qty + sub.qty
         FROM (
           SELECT ticket_type_id, SUM(quantity) AS qty
           FROM orders.order_items WHERE order_id = $1
           GROUP BY ticket_type_id
         ) sub
         WHERE tt.id = sub.ticket_type_id`,
        [rr.order_id],
      );
    }

    await client.query(
      `UPDATE orders.refund_requests
       SET status = 'approved', reviewed_at = NOW(), reviewed_by = $2,
           reviewer_note = $3, refunded_halire = $4, updated_at = NOW()
       WHERE id = $1`,
      [rr.id, promoter.userId, parsed.data.note ?? null, refundedHalire],
    );

    await client.query(
      `INSERT INTO audit.audit_log
         (schema_name, table_name, record_id, action, actor_id, actor_type, new_values)
       VALUES ('orders', 'refund_requests', $1, 'UPDATE', $2, 'promoter', $3::jsonb)`,
      [
        rr.id,
        promoter.userId,
        JSON.stringify({
          decision: 'approve',
          partial,
          refundedHalire,
          note: parsed.data.note,
        }),
      ],
    );

    await client.query('COMMIT');
    return NextResponse.json({
      ok: true,
      decision: 'approved',
      refundedHalire,
      partial,
    });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('[PATCH /api/admin/refund-requests/[id]]', err);
    return NextResponse.json(
      { error: 'INTERNAL', message: err instanceof Error ? err.message : String(err) },
      { status: 500 },
    );
  } finally {
    client.release();
  }
}
