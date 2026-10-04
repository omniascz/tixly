/**
 * Plné vrácení zaplacené objednávky přes platební bránu — jedna cesta pro hromadný refund
 * (/api/admin/orders/bulk-refund), zrušení termínu a žádost o vrácení z odkazu po přesunu (kolo 8 / krok 7).
 *
 * Sdílený stavový automat executeOrderRefund (FIX K2, kolo 6): brána 1×, `refunded` až po potvrzení, chyba brány
 * → `refund_failed` a vstupenky zůstávají; dobropis k dokladu, pokud doklad existuje. Efekty: zneplatnění vstupenek,
 * vrácení kapacity a sedadel.
 */
import type { Pool, PoolClient } from 'pg';
import { db } from '@/lib/db/rls-pool';
import { executeOrderRefund, type RefundOrderResult } from '@/lib/payment/refund-order';

/** Poskytovatelé, u kterých umí refund brána (lib/payment/gateway-refund.ts). */
export const GATEWAY_REFUND_PROVIDERS = ['gopay', 'comgate'];

export async function refundOrderFully(
  orderId: string,
  opts: { actorUserId: string | null; kind: string; reason: string; previousStatus?: string },
): Promise<RefundOrderResult> {
  const total = (await db().query<{ total_amount: number }>(`SELECT total_amount FROM orders.orders WHERE id = $1`, [orderId])).rows[0];
  if (!total) return { http: 404, body: { error: 'ORDER_NOT_FOUND' }, outcome: 'invalid' };
  return executeOrderRefund({
    pool: db() as unknown as Pool,
    orderId,
    amountHalire: total.total_amount,
    finalStatus: 'refunded',
    applyEffects: async (client: PoolClient) => {
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
    audit: async (client: PoolClient) => {
      await client.query(
        `INSERT INTO audit.audit_log
           (schema_name, table_name, record_id, action, actor_id, actor_type, old_values, new_values)
         VALUES ('orders', 'orders', $1, 'UPDATE', $2, $3, $4::jsonb, $5::jsonb)`,
        [
          orderId,
          opts.actorUserId,
          opts.actorUserId ? 'user' : 'system',
          JSON.stringify({ status: opts.previousStatus ?? 'paid' }),
          JSON.stringify({ kind: opts.kind, status: 'refunded', reason: opts.reason, amount_halire: total.total_amount }),
        ],
      );
    },
  });
}
