/**
 * POST /api/admin/orders/bulk-refund
 *
 * Body: { orderIds: string[], reason: 'event_cancelled'|... }
 *
 * Power-user endpoint pro hromadný refund (typicky při zrušení akce).
 * Volá refund logiku per-order v sériové transakci. Vrací summary
 * { processed, refunded, alreadyRefunded, errors[] }.
 *
 * Auth: requirePromoter, ownership check per-order.
 * Rate limit: 5/min per tenant (60s cooldown — bulk refund je destruktivní akce).
 */

import { NextRequest, NextResponse } from 'next/server';
import { Pool } from 'pg';
import { z } from 'zod';
import { requirePromoter } from '@/lib/admin-auth';
import { checkRateLimit, rateLimitResponse } from '@/lib/rate-limit/per-tenant';

let pool: Pool | null = null;
function db(): Pool {
  if (!pool) pool = new Pool({ connectionString: process.env.DATABASE_URL });
  return pool;
}

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
  const promoter = await requirePromoter(req);
  if (!promoter || promoter.status !== 'active') {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const rl = checkRateLimit(`${promoter.promoterId}:bulk-refund`, {
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

  for (const orderId of orderIds) {
    const client = await db().connect();
    try {
      await client.query('BEGIN');
      const orderRes = await client.query<{
        id: string;
        status: string;
        total_amount: number;
        event_promoter_id: string;
      }>(
        `SELECT o.id, o.status, o.total_amount, e.promoter_id AS event_promoter_id
         FROM orders.orders o
         JOIN catalog.events e ON e.id = o.event_id
         WHERE o.id = $1 FOR UPDATE`,
        [orderId],
      );
      if (orderRes.rows.length === 0) {
        await client.query('ROLLBACK');
        outcomes.push({ orderId, status: 'not_found' });
        continue;
      }
      const order = orderRes.rows[0];
      if (order.event_promoter_id !== promoter.promoterId) {
        await client.query('ROLLBACK');
        outcomes.push({ orderId, status: 'wrong_promoter' });
        continue;
      }
      if (order.status === 'refunded') {
        await client.query('ROLLBACK');
        outcomes.push({
          orderId,
          status: 'already_refunded',
          amountHalire: order.total_amount,
        });
        continue;
      }
      if (order.status !== 'paid') {
        await client.query('ROLLBACK');
        outcomes.push({ orderId, status: 'error', reason: `status=${order.status}` });
        continue;
      }

      await client.query(
        `UPDATE orders.orders SET status = 'refunded', updated_at = NOW() WHERE id = $1`,
        [orderId],
      );
      await client.query(
        `UPDATE tickets.tickets
         SET status = 'revoked', revoked_at = NOW(), updated_at = NOW()
         WHERE order_id = $1 AND status <> 'revoked'`,
        [orderId],
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
        [orderId],
      );
      await client.query(
        `INSERT INTO audit.audit_log
           (schema_name, table_name, record_id, action, actor_id, actor_type, old_values, new_values)
         VALUES ('orders', 'orders', $1, 'UPDATE', $2, 'user', $3::jsonb, $4::jsonb)`,
        [
          orderId,
          promoter.userId,
          JSON.stringify({ status: order.status }),
          JSON.stringify({
            kind: 'bulk_refund',
            status: 'refunded',
            reason,
            amount_halire: order.total_amount,
          }),
        ],
      );
      await client.query('COMMIT');
      outcomes.push({
        orderId,
        status: 'refunded',
        amountHalire: order.total_amount,
      });
    } catch (err) {
      await client.query('ROLLBACK');
      outcomes.push({
        orderId,
        status: 'error',
        reason: err instanceof Error ? err.message : 'unknown',
      });
    } finally {
      client.release();
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
}
