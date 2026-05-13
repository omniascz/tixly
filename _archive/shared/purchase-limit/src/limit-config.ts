/**
 * Per-event purchase limit configuration.
 *
 * Promoters can set custom limits per event via the API.
 * Falls back to the platform default (4 tickets) when no custom config exists.
 */

import type { PurchaseLimitConfig } from './purchase-limit.js';
import { DEFAULT_PURCHASE_LIMIT } from './purchase-limit.js';

export interface LimitConfigDb {
  query<T>(sql: string, params?: unknown[]): Promise<T[]>;
  execute(sql: string, params?: unknown[]): Promise<void>;
}

export interface EventLimitConfig {
  eventId: string;
  maxTicketsPerUser: number;
  verifiedOnly: boolean;
  updatedAt: string;
}

/**
 * Get the purchase limit configuration for an event.
 * Falls back to platform default if no custom config exists.
 */
export async function getEventLimitConfig(
  eventId: string,
  db: LimitConfigDb,
): Promise<PurchaseLimitConfig> {
  const rows = await db.query<{
    max_tickets_per_user: number;
    verified_only: boolean;
  }>(
    `SELECT max_tickets_per_user, verified_only
     FROM catalog.purchase_limit_configs
     WHERE event_id = $1`,
    [eventId],
  );

  if (rows.length === 0) return DEFAULT_PURCHASE_LIMIT;

  return {
    maxTicketsPerUser: rows[0].max_tickets_per_user,
    verifiedOnly: rows[0].verified_only,
  };
}

/**
 * Set a custom purchase limit for an event (promoter action).
 */
export async function setEventLimitConfig(
  eventId: string,
  config: { maxTicketsPerUser: number; verifiedOnly: boolean },
  db: LimitConfigDb,
): Promise<EventLimitConfig> {
  if (config.maxTicketsPerUser < 1 || config.maxTicketsPerUser > 100) {
    throw new Error('maxTicketsPerUser musí být mezi 1 a 100.');
  }

  const rows = await db.query<EventLimitConfig>(
    `INSERT INTO catalog.purchase_limit_configs
       (event_id, max_tickets_per_user, verified_only)
     VALUES ($1, $2, $3)
     ON CONFLICT (event_id) DO UPDATE SET
       max_tickets_per_user = EXCLUDED.max_tickets_per_user,
       verified_only = EXCLUDED.verified_only,
       updated_at = NOW()
     RETURNING event_id AS "eventId",
               max_tickets_per_user AS "maxTicketsPerUser",
               verified_only AS "verifiedOnly",
               updated_at::text AS "updatedAt"`,
    [eventId, config.maxTicketsPerUser, config.verifiedOnly],
  );

  return rows[0];
}

/**
 * Remove custom purchase limit config (fall back to platform default).
 */
export async function removeEventLimitConfig(
  eventId: string,
  db: LimitConfigDb,
): Promise<boolean> {
  const rows = await db.query<{ event_id: string }>(
    `DELETE FROM catalog.purchase_limit_configs WHERE event_id = $1 RETURNING event_id`,
    [eventId],
  );
  return rows.length > 0;
}
