/**
 * SQL-based implementation of PurchaseLimitDb.
 *
 * Queries orders.order_items + orders.orders for ticket counts
 * and identity.users for verification status.
 */

import type { PurchaseLimitDb } from './purchase-limit.js';

interface SqlDb {
  query<T>(sql: string, params?: unknown[]): Promise<T[]>;
}

/**
 * Creates a PurchaseLimitDb adapter backed by real SQL queries.
 */
export function createSqlPurchaseLimitDb(db: SqlDb): PurchaseLimitDb {
  return {
    async countUserTicketsForEvent(userId: string, eventId: string): Promise<number> {
      const rows = await db.query<{ total: string | number }>(
        `SELECT COALESCE(SUM(oi.quantity), 0) AS total
         FROM orders.order_items oi
         JOIN orders.orders o ON o.id = oi.order_id
         WHERE o.user_id = $1
           AND oi.event_id = $2
           AND o.status IN ('paid', 'pending')`,
        [userId, eventId],
      );
      return Number(rows[0]?.total ?? 0);
    },

    async isUserVerified(userId: string): Promise<boolean> {
      const rows = await db.query<{ email_verified: boolean }>(
        `SELECT email_verified FROM identity.users WHERE id = $1`,
        [userId],
      );
      return rows[0]?.email_verified ?? false;
    },
  };
}
