/**
 * POST /api/buyer/orders/[orderId]/cancel
 *
 * Eventbrite self-service buyer cancel order.
 *
 * Flow:
 *   1. Verify ownership (order.user_id = current user)
 *   2. Check event.allow_buyer_cancel + deadline
 *   3. Pokud pending → instantní cancel (žádný refund needed)
 *   4. Pokud paid → spočítat refund_pct podle deadline:
 *      - před deadline = refund_pct_before_deadline (default 100 %)
 *      - po deadline = refund_pct_after_deadline (default 0 %)
 *   5. Vytvoř refund_request (admin zpracuje) nebo "no refund" pokud 0 %
 *   6. Mark order.status = 'cancelled', cancelled_by_buyer_at = now()
 *   7. Zneplatni tickety (status = 'revoked')
 */
import { NextRequest, NextResponse } from 'next/server';
import { asSystemInTx, db } from '@/lib/db/rls-pool';
import { runAsUser } from '@/lib/auth';
import { z } from 'zod';


const schema = z.object({
  reason: z.string().max(500).optional(),
});

export async function POST(req: NextRequest, props: { params: Promise<{ orderId: string }> }): Promise<Response> {
  const params = await props.params;
  return runAsUser(req, async (userId) => {
  const body: unknown = await req.json().catch(() => ({}));
  const parsed = schema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: 'INVALID_BODY' }, { status: 422 });

  const client = await db().connect();
  try {
    await client.query('BEGIN');

    const o = await client.query<{
      id: string;
      user_id: string;
      event_id: string;
      status: string;
      total_amount: number;
      allow_cancel: boolean;
      deadline_hours: number;
      pct_before: number;
      pct_after: number;
      event_date_start: string;
      promoter_id: string;
    }>(
      `SELECT o.id, o.user_id, o.event_id, o.status, o.total_amount,
              COALESCE(e.allow_buyer_cancel, true) AS allow_cancel,
              COALESCE(e.buyer_cancel_deadline_hours_before, 48) AS deadline_hours,
              COALESCE(e.refund_pct_before_deadline, 100) AS pct_before,
              COALESCE(e.refund_pct_after_deadline, 0) AS pct_after,
              e.date_start::text AS event_date_start,
              e.promoter_id
         FROM orders.orders o
         JOIN catalog.events e ON e.id = o.event_id
        WHERE o.id = $1
          FOR UPDATE OF o`,
      [params.orderId],
    );

    if (o.rows.length === 0) {
      await client.query('ROLLBACK');
      return NextResponse.json({ error: 'NOT_FOUND' }, { status: 404 });
    }
    const order = o.rows[0];

    if (order.user_id !== userId) {
      await client.query('ROLLBACK');
      return NextResponse.json({ error: 'NOT_OWNER' }, { status: 403 });
    }

    if (order.status === 'cancelled') {
      await client.query('ROLLBACK');
      return NextResponse.json({ error: 'ALREADY_CANCELLED' }, { status: 409 });
    }
    if (!['pending', 'paid', 'paid_partial'].includes(order.status)) {
      await client.query('ROLLBACK');
      return NextResponse.json({
        error: 'CANNOT_CANCEL_STATUS', status: order.status,
      }, { status: 409 });
    }
    if (!order.allow_cancel) {
      await client.query('ROLLBACK');
      return NextResponse.json({ error: 'CANCEL_DISABLED_BY_PROMOTER' }, { status: 409 });
    }

    // Compute refund
    const deadlineMs = new Date(order.event_date_start).getTime() - order.deadline_hours * 3_600_000;
    const beforeDeadline = Date.now() < deadlineMs;
    const refundPct = beforeDeadline ? order.pct_before : order.pct_after;
    const refundAmount = order.status === 'pending' || order.status === 'paid' || order.status === 'paid_partial'
      ? Math.round((order.total_amount * refundPct) / 100)
      : 0;

    // Update order — status a revoke lístků jsou chráněné sloupce (guard 486): systémový
    // efekt storna, objednávka je výše ověřena jako kupcova pod jeho RLS kontextem.
    await asSystemInTx(client, () => client.query(
      `UPDATE orders.orders
          SET status = 'cancelled',
              cancelled_by_buyer_at = now(),
              cancellation_reason = $1,
              cancellation_refund_status = $2,
              updated_at = now()
        WHERE id = $3`,
      [
        parsed.data.reason ?? null,
        refundAmount > 0 ? 'pending' : 'no_refund',
        params.orderId,
      ],
    ));

    // Revoke tickety
    await asSystemInTx(client, () => client.query(
      `UPDATE tickets.tickets
          SET status = 'revoked', updated_at = now()
        WHERE order_id = $1 AND status = 'valid'`,
      [params.orderId],
    ));

    // Free up ticket_type stock — systémový efekt (kapacitu kupec měnit nesmí, kolo 2 / V8);
    // objednávka je výše ověřena jako kupcova pod jeho RLS kontextem.
    await asSystemInTx(client, () => client.query(
      `UPDATE catalog.ticket_types tt
          SET remaining_qty = remaining_qty + (
            SELECT COUNT(*) FROM tickets.tickets
             WHERE order_id = $1 AND ticket_type_id = tt.id
          )
        WHERE EXISTS (SELECT 1 FROM tickets.tickets
                       WHERE order_id = $1 AND ticket_type_id = tt.id)`,
      [params.orderId],
    ));

    // Refund request pokud nějaký.
    // POZOR: žádný .catch() tady — refund_request NENÍ best-effort. Když selže,
    // musí probublat do outer catch → ROLLBACK → 500 (ne tichá 200 + ztracený
    // refundační závazek). Jinak COMMIT na aborted tx projde jako ROLLBACK a
    // celý cancel se zahodí, přestože endpoint vrátí úspěch.
    if (refundAmount > 0 && order.status !== 'pending') {
      await client.query(
        `INSERT INTO orders.refund_requests
           (order_id, user_id, refunded_halire, reason, status, promoter_id)
         VALUES ($1, $2, $3, $4, 'pending', $5)`,
        [
          params.orderId, order.user_id, refundAmount,
          `Buyer self-service cancel${parsed.data.reason ? ': ' + parsed.data.reason : ''}`,
          order.promoter_id,
        ],
      );
    }

    await client.query('COMMIT');

    return NextResponse.json({
      ok: true,
      orderId: params.orderId,
      refundAmount,
      refundPct,
      beforeDeadline,
      message: refundAmount > 0
        ? `Objednávka zrušena. Refund ${(refundAmount / 100).toFixed(0)} Kč (${refundPct}%) bude zpracován do 7 dní.`
        : 'Objednávka zrušena. Lhůta pro refund vypršela, peníze se nevrací.',
    });
  } catch (e) {
    await client.query('ROLLBACK');
    console.error('[order cancel]', e);
    return NextResponse.json({ error: 'DB_ERROR' }, { status: 500 });
  } finally {
    client.release();
  }

  });
}
