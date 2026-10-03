/**
 * POST /api/admin/orders/bulk-refund
 *
 * Body: { orderIds: string[], reason: 'event_cancelled'|... }
 *
 * Power-user endpoint pro hromadný refund (typicky při zrušení akce).
 * Každou objednávku vrací přes platební bránu sdíleným automatem executeOrderRefund (kolo 6;
 * dřív jen přepnul stav v DB a peníze se nevracely). Vrací summary
 * { processed, refunded, alreadyRefunded, errors[] }.
 *
 * Auth: requirePromoter, ownership check per-order.
 * Rate limit: 5/min per tenant (60s cooldown — bulk refund je destruktivní akce).
 */

import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db/rls-pool';
import { executeOrderRefund } from '@/lib/payment/refund-order';
import { runAsActivePromoter } from '@/lib/admin-auth';
import { z } from 'zod';
import { checkRateLimit, rateLimitResponse } from '@/lib/rate-limit/per-tenant';


const REASONS = [
  'event_cancelled',
  'customer_request',
  'duplicate_order',
  'fraud',
  'chargeback',
] as const;

const schema = z.object({
  orderIds: z.array(z.string().regex(/^[0-9a-f-]{36}$/i)).min(1).max(100),
  reason: z.enum(REASONS).default('customer_request'),
});

interface RefundOutcome {
  orderId: string;
  status: 'refunded' | 'already_refunded' | 'wrong_promoter' | 'not_found' | 'error';
  amountHalire?: number;
  reason?: string;
}

export async function POST(req: NextRequest): Promise<Response> {
  return runAsActivePromoter(req, async (promoter) => {
  const rl = await checkRateLimit(`${promoter.promoterId}:bulk-refund`, {
    limit: 5,
    windowMs: 60_000,
  });
  const rlResp = rateLimitResponse(rl, 'bulk-refund');
  if (rlResp) return rlResp;

  const body: unknown = await req.json().catch(() => ({}));
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'Validation failed', issues: parsed.error.issues },
      { status: 422 },
    );
  }
  const { orderIds, reason } = parsed.data;

  const outcomes: RefundOutcome[] = [];

  // Kolo 6: každá objednávka jde sdíleným stavovým automatem refundu (FIX K2) — brána 1×,
  // `refunded` až po jejím potvrzení, chyba brány → `refund_failed` a lístky zůstávají.
  // Dřív se tu jen přepnul stav v DB a peníze se nevracely.
  for (const orderId of orderIds) {
    try {
      const own = await db().query<{ status: string; total_amount: number; event_promoter_id: string }>(
        `SELECT o.status, o.total_amount, e.promoter_id AS event_promoter_id
           FROM orders.orders o JOIN catalog.events e ON e.id = o.event_id
          WHERE o.id = $1`,
        [orderId],
      );
      const order = own.rows[0];
      if (!order) {
        outcomes.push({ orderId, status: 'not_found' });
        continue;
      }
      if (order.event_promoter_id !== promoter.promoterId) {
        outcomes.push({ orderId, status: 'wrong_promoter' });
        continue;
      }
      const result = await executeOrderRefund({
        pool: db() as unknown as import('pg').Pool,
        orderId,
        amountHalire: order.total_amount,
        finalStatus: 'refunded',
        applyEffects: async (client) => {
          await client.query(
            `UPDATE tickets.tickets SET status = 'revoked', revoked_at = NOW(), updated_at = NOW()
              WHERE order_id = $1 AND status <> 'revoked'`,
            [orderId],
          );
          await client.query(
            `UPDATE catalog.ticket_types tt SET remaining_qty = remaining_qty + sub.qty
               FROM (SELECT ticket_type_id, SUM(quantity) AS qty FROM orders.order_items
                      WHERE order_id = $1 GROUP BY ticket_type_id) sub
              WHERE tt.id = sub.ticket_type_id`,
            [orderId],
          );
          await client.query(
            `UPDATE catalog.event_seats
                SET status = 'available', order_id = NULL, ticket_id = NULL,
                    hold_user_id = NULL, hold_until = NULL, updated_at = NOW()
              WHERE order_id = $1
                 OR id IN (SELECT seat_id FROM orders.order_items WHERE order_id = $1 AND seat_id IS NOT NULL)`,
            [orderId],
          );
        },
        audit: async (client) => {
          await client.query(
            `INSERT INTO audit.audit_log
               (schema_name, table_name, record_id, action, actor_id, actor_type, old_values, new_values)
             VALUES ('orders', 'orders', $1, 'UPDATE', $2, 'user', $3::jsonb, $4::jsonb)`,
            [
              orderId,
              promoter.userId,
              JSON.stringify({ status: order.status }),
              JSON.stringify({ kind: 'bulk_refund', status: 'refunded', reason, amount_halire: order.total_amount }),
            ],
          );
        },
      });
      if (result.outcome === 'refunded') {
        outcomes.push({ orderId, status: 'refunded', amountHalire: order.total_amount });
      } else if (result.outcome === 'already') {
        outcomes.push({ orderId, status: 'already_refunded', amountHalire: order.total_amount });
      } else {
        outcomes.push({ orderId, status: 'error', reason: String(result.body.error ?? result.outcome) });
      }
    } catch (err) {
      outcomes.push({ orderId, status: 'error', reason: err instanceof Error ? err.message : 'unknown' });
    }
  }

  const refunded = outcomes.filter((o) => o.status === 'refunded');
  const totalRefundedHalire = refunded.reduce((s, o) => s + (o.amountHalire ?? 0), 0);

  return NextResponse.json({
    processed: outcomes.length,
    refundedCount: refunded.length,
    alreadyRefundedCount: outcomes.filter((o) => o.status === 'already_refunded').length,
    errorCount: outcomes.filter((o) => o.status === 'error' || o.status === 'wrong_promoter' || o.status === 'not_found').length,
    totalRefundedHalire,
    outcomes,
  });

  });
}
