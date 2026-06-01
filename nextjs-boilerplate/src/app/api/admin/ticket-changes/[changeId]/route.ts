/**
 * POST /api/admin/ticket-changes/[changeId]
 *
 * Promotér schválí pending ticket_change. Po approve:
 *   1. Update tickets.tickets row (ticket_type_id, event seat, ...)
 *   2. Increment/decrement ticket_types remaining_qty
 *   3. Pokud price_diff > 0: vytvořit faktura pro doplatek (TODO real payment)
 *   4. Pokud refund > 0: vytvořit refund_request
 *   5. Mark change_request as completed
 *
 * Body: { action: 'approve' | 'reject', notes? }
 */
import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db/rls-pool';
import { runAsPromoter } from '@/lib/admin-auth';
import { z } from 'zod';


const schema = z.object({
  action: z.enum(['approve', 'reject']),
  notes: z.string().max(500).optional(),
});

export async function POST(
  req: NextRequest,
  { params }: { params: { changeId: string } },
): Promise<Response> {
  return runAsPromoter(req, async (promoter) => {
  const body: unknown = await req.json().catch(() => ({}));
  const parsed = schema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: 'INVALID_BODY' }, { status: 422 });

  const client = await db().connect();
  try {
    await client.query('BEGIN');

    const ch = await client.query<{
      id: string;
      ticket_id: string;
      change_type: string;
      old_ticket_type_id: string | null;
      new_ticket_type_id: string | null;
      new_event_id: string | null;
      new_seat_id: string | null;
      price_diff_halire: number;
      refund_amount_halire: number;
      status: string;
      promoter_id: string;
    }>(
      `SELECT tc.id, tc.ticket_id, tc.change_type,
              tc.old_ticket_type_id, tc.new_ticket_type_id,
              tc.new_event_id, tc.new_seat_id,
              tc.price_diff_halire, tc.refund_amount_halire, tc.status,
              e.promoter_id
         FROM tickets.ticket_changes tc
         JOIN tickets.tickets t ON t.id = tc.ticket_id
         JOIN orders.orders o ON o.id = t.order_id
         JOIN catalog.events e ON e.id = o.event_id
        WHERE tc.id = $1
          FOR UPDATE`,
      [params.changeId],
    );

    if (ch.rows.length === 0) {
      await client.query('ROLLBACK');
      return NextResponse.json({ error: 'NOT_FOUND' }, { status: 404 });
    }
    const change = ch.rows[0];

    if (change.promoter_id !== promoter.promoterId) {
      await client.query('ROLLBACK');
      return NextResponse.json({ error: 'NOT_OWNER' }, { status: 403 });
    }
    if (change.status !== 'pending') {
      await client.query('ROLLBACK');
      return NextResponse.json({ error: 'ALREADY_RESOLVED', status: change.status }, { status: 409 });
    }

    if (parsed.data.action === 'reject') {
      await client.query(
        `UPDATE tickets.ticket_changes
            SET status = 'rejected', completed_at = now()
          WHERE id = $1`,
        [params.changeId],
      );
      await client.query('COMMIT');
      return NextResponse.json({ ok: true, status: 'rejected' });
    }

    // APPROVE: aplikuj změnu na ticket
    if (change.change_type === 'ticket_type' && change.new_ticket_type_id) {
      // Verify nová ticket_type stále má místo
      const newTt = await client.query<{ remaining_qty: number }>(
        `SELECT remaining_qty FROM catalog.ticket_types WHERE id = $1 FOR UPDATE`,
        [change.new_ticket_type_id],
      );
      if (newTt.rows.length === 0 || newTt.rows[0].remaining_qty <= 0) {
        await client.query('ROLLBACK');
        return NextResponse.json({ error: 'NEW_TICKET_SOLD_OUT' }, { status: 409 });
      }

      await client.query(
        `UPDATE tickets.tickets
            SET ticket_type_id = $1, updated_at = now()
          WHERE id = $2`,
        [change.new_ticket_type_id, change.ticket_id],
      );
      // Decrement new, increment old
      await client.query(
        `UPDATE catalog.ticket_types SET remaining_qty = remaining_qty - 1 WHERE id = $1`,
        [change.new_ticket_type_id],
      );
      if (change.old_ticket_type_id) {
        await client.query(
          `UPDATE catalog.ticket_types SET remaining_qty = remaining_qty + 1 WHERE id = $1`,
          [change.old_ticket_type_id],
        );
      }
    }

    if (change.change_type === 'seat' && change.new_seat_id) {
      await client.query(
        `UPDATE tickets.tickets SET event_seat_id = $1, updated_at = now() WHERE id = $2`,
        [change.new_seat_id, change.ticket_id],
      );
    }

    // Refund pokud applicable — vytvoříme refund_request (admin musí potvrdit)
    if (change.refund_amount_halire > 0) {
      await client.query(
        `INSERT INTO orders.refund_requests
           (order_id, amount_halire, reason, status, promoter_id, created_at)
         SELECT t.order_id, $1, $2, 'pending', $3, now()
           FROM tickets.tickets t WHERE t.id = $4`,
        [change.refund_amount_halire, `Ticket swap ${change.change_type}`, promoter.promoterId, change.ticket_id],
      ).catch(() => null);
    }

    await client.query(
      `UPDATE tickets.ticket_changes
          SET status = 'completed', completed_at = now()
        WHERE id = $1`,
      [params.changeId],
    );

    await client.query('COMMIT');
    return NextResponse.json({
      ok: true,
      status: 'completed',
      refundQueued: change.refund_amount_halire > 0,
      additionalChargeNeeded: change.price_diff_halire > 0,
    });
  } catch (e) {
    await client.query('ROLLBACK');
    console.error('[ticket-changes approve]', e);
    return NextResponse.json({ error: 'DB_ERROR' }, { status: 500 });
  } finally {
    client.release();
  }

  });
}
