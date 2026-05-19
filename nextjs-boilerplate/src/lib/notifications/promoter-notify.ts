/**
 * Helper pro vkládání notifikací promotérů.
 *
 * Voláno z API endpointů, cronů, hooků. Idempotence per (promoterId, kind,
 * payload.dedupe_key) se nedělá v DB — caller je odpovědný za to,
 * že nezavolá stejnou notifikaci 2× během cron run.
 */

import { Pool } from 'pg';

let pool: Pool | null = null;
function db(): Pool {
  if (!pool) pool = new Pool({ connectionString: process.env.DATABASE_URL });
  return pool;
}

export type NotificationKind =
  | 'refund_request'
  | 'payout_settled'
  | 'payout_failed'
  | 'rolling_reserve_released'
  | 'abandoned_cart_high'
  | 'event_moderation'
  | 'churn_risk'
  | 'holdback_ended'
  | 'low_inventory'
  | 'general';

export type Severity = 'info' | 'warn' | 'critical';

export interface NotifyInput {
  promoterId: string;
  kind: NotificationKind;
  title: string;
  body?: string;
  link?: string;
  severity?: Severity;
  payload?: Record<string, unknown>;
}

export async function notifyPromoter(input: NotifyInput): Promise<string> {
  const r = await db().query<{ id: string }>(
    `INSERT INTO notifications.promoter_notifications
       (promoter_id, kind, severity, title, body, link, payload)
     VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb)
     RETURNING id`,
    [
      input.promoterId,
      input.kind,
      input.severity ?? 'info',
      input.title,
      input.body ?? null,
      input.link ?? null,
      JSON.stringify(input.payload ?? {}),
    ],
  );
  return r.rows[0].id;
}
