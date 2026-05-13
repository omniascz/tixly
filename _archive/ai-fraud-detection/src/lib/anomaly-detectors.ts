// =============================================================================
// Anomaly detectors — pure functions, one per detection kind
//
// Each detector queries the existing risk/orders/payments/accounts tables and
// returns a single AnomalySignal or null. They are intentionally independent
// so they can be composed by detection-runner and unit-tested in isolation.
//
// Schema assumptions (documented where uncertain):
//   orders.orders            (id, user_id, event_id, total_hellers, created_at, ip_address)
//   payments.payments        (id, order_id, card_fingerprint, amount_hellers, status, created_at)
//   risk.device_fingerprints (fingerprint_hash, user_id, ip_hash, seen_at)
//   accounts.users           (id, created_at, last_login_at)
//   accounts.login_events    (user_id, country_code, created_at)
//   orders.refunds           (order_id, refunded_at, refunded_to_user_id)
// =============================================================================

import type { AnomalySignal, Severity } from '../types/detection.js';
import type { ServiceDeps } from './service-container.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeSignal(
  type: AnomalySignal['type'],
  severity: Severity,
  confidence: number,
  description: string,
  linkedEntityIds: string[] = [],
): AnomalySignal {
  return {
    type,
    severity,
    confidence,
    description,
    linkedEntityIds,
    detectedAt: new Date(),
  };
}

function toInt(v: unknown): number {
  if (typeof v === 'number') return v;
  if (typeof v === 'string') return parseInt(v, 10) || 0;
  return 0;
}

function toFloat(v: unknown): number {
  if (typeof v === 'number') return v;
  if (typeof v === 'string') return parseFloat(v) || 0;
  return 0;
}

// ---------------------------------------------------------------------------
// 1. Velocity spike
// ---------------------------------------------------------------------------

/**
 * Velocity: many orders from same user/device in short window (last 1 hour).
 *   > 10 orders → critical
 *   > 5        → high
 *   > 3        → medium
 *   otherwise  → null
 */
export async function detectVelocitySpike(
  subjectType: 'user' | 'device',
  subjectId: string,
  deps: ServiceDeps,
): Promise<AnomalySignal | null> {
  const sql =
    subjectType === 'user'
      ? `SELECT COUNT(*)::int AS cnt, ARRAY_AGG(id::text) AS ids
         FROM orders.orders
         WHERE user_id = $1 AND created_at > NOW() - INTERVAL '1 hour'`
      : `SELECT COUNT(*)::int AS cnt, ARRAY_AGG(DISTINCT o.id::text) AS ids
         FROM orders.orders o
         JOIN risk.device_fingerprints df ON df.user_id = o.user_id
         WHERE df.fingerprint_hash = $1 AND o.created_at > NOW() - INTERVAL '1 hour'`;

  const rows = await deps.db.query<{ cnt: number; ids: string[] | null }>(sql, [subjectId]);
  const cnt = toInt(rows[0]?.cnt);
  const ids = rows[0]?.ids ?? [];

  if (cnt > 10) {
    return makeSignal(
      'velocity_spike',
      'critical',
      95,
      `Velocity spike: ${cnt} orders in last hour`,
      ids,
    );
  }
  if (cnt > 5) {
    return makeSignal('velocity_spike', 'high', 80, `Velocity high: ${cnt} orders in last hour`, ids);
  }
  if (cnt > 3) {
    return makeSignal(
      'velocity_spike',
      'medium',
      60,
      `Velocity elevated: ${cnt} orders in last hour`,
      ids,
    );
  }
  return null;
}

// ---------------------------------------------------------------------------
// 2. Price outlier (vs user history)
// ---------------------------------------------------------------------------

/**
 * Flags an order whose amount is > N stddevs above the user's historical mean.
 * Requires at least 5 prior orders to be statistically meaningful.
 */
export async function detectPriceOutlier(
  orderId: string,
  deps: ServiceDeps,
): Promise<AnomalySignal | null> {
  const [order] = await deps.db.query<{ user_id: string; total_hellers: number }>(
    `SELECT user_id, total_hellers FROM orders.orders WHERE id = $1`,
    [orderId],
  );
  if (!order) return null;

  const [stats] = await deps.db.query<{ avg: string | null; stddev: string | null; cnt: number }>(
    `SELECT AVG(total_hellers) AS avg, STDDEV(total_hellers) AS stddev, COUNT(*)::int AS cnt
     FROM orders.orders
     WHERE user_id = $1 AND id <> $2 AND created_at > NOW() - INTERVAL '180 days'`,
    [order.user_id, orderId],
  );
  const cnt = toInt(stats?.cnt);
  if (cnt < 5) return null;

  const avg = toFloat(stats?.avg);
  const stddev = toFloat(stats?.stddev);
  if (stddev <= 0) return null;

  const zScore = (order.total_hellers - avg) / stddev;
  if (zScore >= 5) {
    return makeSignal(
      'price_outlier',
      'critical',
      90,
      `Order amount ${zScore.toFixed(1)}σ above user mean`,
      [orderId],
    );
  }
  if (zScore >= 3.5) {
    return makeSignal(
      'price_outlier',
      'high',
      75,
      `Order amount ${zScore.toFixed(1)}σ above user mean`,
      [orderId],
    );
  }
  if (zScore >= 2.5) {
    return makeSignal(
      'price_outlier',
      'medium',
      55,
      `Order amount ${zScore.toFixed(1)}σ above user mean`,
      [orderId],
    );
  }
  return null;
}

// ---------------------------------------------------------------------------
// 3. Time outlier (unusual hour)
// ---------------------------------------------------------------------------

/**
 * Flags orders made between 03:00–05:00 local (Europe/Prague). Organic
 * consumer traffic in this window is very low — a signal worth reviewing
 * in conjunction with other flags, but not strongly on its own.
 */
export async function detectTimeOutlier(
  orderId: string,
  deps: ServiceDeps,
): Promise<AnomalySignal | null> {
  const [row] = await deps.db.query<{ hour_local: number }>(
    `SELECT EXTRACT(HOUR FROM (created_at AT TIME ZONE 'Europe/Prague'))::int AS hour_local
     FROM orders.orders WHERE id = $1`,
    [orderId],
  );
  if (!row) return null;
  const hour = toInt(row.hour_local);

  if (hour >= 3 && hour <= 5) {
    return makeSignal(
      'time_outlier',
      'medium',
      50,
      `Purchase at unusual hour (${hour}:00 local)`,
      [orderId],
    );
  }
  return null;
}

// ---------------------------------------------------------------------------
// 4. Amount outlier (vs event ticket-type typical)
// ---------------------------------------------------------------------------

/**
 * Flags an order where total is dramatically larger than the typical ticket
 * spend for the same event.
 */
export async function detectAmountOutlier(
  orderId: string,
  deps: ServiceDeps,
): Promise<AnomalySignal | null> {
  const [order] = await deps.db.query<{ event_id: string | null; total_hellers: number }>(
    `SELECT event_id, total_hellers FROM orders.orders WHERE id = $1`,
    [orderId],
  );
  if (!order || !order.event_id) return null;

  const [stats] = await deps.db.query<{ avg: string | null; stddev: string | null; cnt: number }>(
    `SELECT AVG(total_hellers) AS avg, STDDEV(total_hellers) AS stddev, COUNT(*)::int AS cnt
     FROM orders.orders WHERE event_id = $1 AND id <> $2`,
    [order.event_id, orderId],
  );
  const cnt = toInt(stats?.cnt);
  if (cnt < 20) return null;

  const avg = toFloat(stats?.avg);
  const stddev = toFloat(stats?.stddev);
  if (stddev <= 0) return null;
  const z = (order.total_hellers - avg) / stddev;

  if (z >= 4) {
    return makeSignal(
      'amount_outlier',
      'high',
      80,
      `Order ${z.toFixed(1)}σ above event mean`,
      [orderId],
    );
  }
  if (z >= 2.5) {
    return makeSignal(
      'amount_outlier',
      'medium',
      55,
      `Order ${z.toFixed(1)}σ above event mean`,
      [orderId],
    );
  }
  return null;
}

// ---------------------------------------------------------------------------
// 5. Duplicate card (same card fingerprint across multiple users)
// ---------------------------------------------------------------------------

export async function detectDuplicateCard(
  cardFingerprint: string,
  deps: ServiceDeps,
): Promise<AnomalySignal | null> {
  const [row] = await deps.db.query<{ user_count: number; user_ids: string[] | null }>(
    `SELECT COUNT(DISTINCT o.user_id)::int AS user_count,
            ARRAY_AGG(DISTINCT o.user_id::text) AS user_ids
     FROM payments.payments p
     JOIN orders.orders o ON o.id = p.order_id
     WHERE p.card_fingerprint = $1 AND p.created_at > NOW() - INTERVAL '90 days'`,
    [cardFingerprint],
  );
  const n = toInt(row?.user_count);
  const ids = row?.user_ids ?? [];

  if (n >= 5) {
    return makeSignal(
      'duplicate_card',
      'critical',
      95,
      `Card used by ${n} distinct accounts`,
      ids,
    );
  }
  if (n >= 3) {
    return makeSignal('duplicate_card', 'high', 80, `Card used by ${n} distinct accounts`, ids);
  }
  if (n >= 2) {
    return makeSignal(
      'duplicate_card',
      'medium',
      55,
      `Card used by ${n} distinct accounts`,
      ids,
    );
  }
  return null;
}

// ---------------------------------------------------------------------------
// 6. Shared device cluster
// ---------------------------------------------------------------------------

export async function detectSharedDeviceCluster(
  fingerprintHash: string,
  deps: ServiceDeps,
): Promise<AnomalySignal | null> {
  const [row] = await deps.db.query<{ user_count: number; user_ids: string[] | null }>(
    `SELECT COUNT(DISTINCT user_id)::int AS user_count,
            ARRAY_AGG(DISTINCT user_id::text) AS user_ids
     FROM risk.device_fingerprints
     WHERE fingerprint_hash = $1
       AND user_id IS NOT NULL
       AND seen_at > NOW() - INTERVAL '24 hours'`,
    [fingerprintHash],
  );
  const n = toInt(row?.user_count);
  const ids = row?.user_ids ?? [];

  if (n > 5) {
    return makeSignal(
      'shared_device_cluster',
      'critical',
      95,
      `Device shared by ${n} distinct users in 24h`,
      ids,
    );
  }
  if (n > 3) {
    return makeSignal(
      'shared_device_cluster',
      'high',
      80,
      `Device shared by ${n} distinct users in 24h`,
      ids,
    );
  }
  if (n > 2) {
    return makeSignal(
      'shared_device_cluster',
      'medium',
      55,
      `Device shared by ${n} distinct users in 24h`,
      ids,
    );
  }
  return null;
}

// ---------------------------------------------------------------------------
// 7. Circular refund (A↔B ping-pong)
// ---------------------------------------------------------------------------

/**
 * Looks for suspicious refund cycles: the user refunded an order that was
 * paid by another user who also refunded one of this user's orders. A weak
 * heuristic version — matches 2 refund cycles in the last 30 days.
 */
export async function detectCircularRefund(
  userId: string,
  deps: ServiceDeps,
): Promise<AnomalySignal | null> {
  const rows = await deps.db.query<{ counterparty: string; cycles: number }>(
    `SELECT counterparty, COUNT(*)::int AS cycles FROM (
       SELECT r1.refunded_to_user_id AS counterparty
       FROM orders.refunds r1
       JOIN orders.orders o1 ON o1.id = r1.order_id
       JOIN orders.refunds r2 ON r2.refunded_to_user_id = o1.user_id
       JOIN orders.orders o2 ON o2.id = r2.order_id AND o2.user_id = r1.refunded_to_user_id
       WHERE o1.user_id = $1
         AND r1.refunded_at > NOW() - INTERVAL '30 days'
         AND r2.refunded_at > NOW() - INTERVAL '30 days'
     ) x
     GROUP BY counterparty
     HAVING COUNT(*) >= 2`,
    [userId],
  );

  if (rows.length === 0) return null;

  const severity: Severity = rows.length >= 2 ? 'critical' : 'high';
  const linked = rows.map((r) => r.counterparty);
  return makeSignal(
    'circular_refund',
    severity,
    85,
    `Circular refund pattern with ${rows.length} counterparties`,
    linked,
  );
}

// ---------------------------------------------------------------------------
// 8. Rapid account creation
// ---------------------------------------------------------------------------

export async function detectRapidAccountCreation(
  ipAddress: string,
  deps: ServiceDeps,
): Promise<AnomalySignal | null> {
  const [row] = await deps.db.query<{ cnt: number; user_ids: string[] | null }>(
    `SELECT COUNT(*)::int AS cnt, ARRAY_AGG(id::text) AS user_ids
     FROM accounts.users
     WHERE signup_ip = $1 AND created_at > NOW() - INTERVAL '1 hour'`,
    [ipAddress],
  );
  const cnt = toInt(row?.cnt);
  const ids = row?.user_ids ?? [];

  if (cnt > 10) {
    return makeSignal(
      'rapid_account_creation',
      'critical',
      95,
      `${cnt} accounts created from same IP in 1h`,
      ids,
    );
  }
  if (cnt > 5) {
    return makeSignal(
      'rapid_account_creation',
      'high',
      80,
      `${cnt} accounts created from same IP in 1h`,
      ids,
    );
  }
  if (cnt > 3) {
    return makeSignal(
      'rapid_account_creation',
      'medium',
      55,
      `${cnt} accounts created from same IP in 1h`,
      ids,
    );
  }
  return null;
}

// ---------------------------------------------------------------------------
// 9. Geographic jump
// ---------------------------------------------------------------------------

/**
 * Looks for back-to-back login events from different countries within a
 * physically implausible window (< 30 minutes).
 */
export async function detectGeographicJump(
  userId: string,
  deps: ServiceDeps,
): Promise<AnomalySignal | null> {
  const rows = await deps.db.query<{
    country_code: string;
    created_at: string;
    prev_country: string | null;
    prev_at: string | null;
    gap_seconds: string | null;
  }>(
    `SELECT country_code, created_at,
            LAG(country_code) OVER (ORDER BY created_at) AS prev_country,
            LAG(created_at) OVER (ORDER BY created_at) AS prev_at,
            EXTRACT(EPOCH FROM (created_at - LAG(created_at) OVER (ORDER BY created_at))) AS gap_seconds
     FROM accounts.login_events
     WHERE user_id = $1 AND created_at > NOW() - INTERVAL '24 hours'
     ORDER BY created_at DESC
     LIMIT 20`,
    [userId],
  );

  for (const r of rows) {
    if (!r.prev_country || r.prev_country === r.country_code) continue;
    const gap = toFloat(r.gap_seconds);
    if (gap > 0 && gap < 1800) {
      return makeSignal(
        'geographic_jump',
        'high',
        85,
        `Login from ${r.prev_country} → ${r.country_code} in ${Math.round(gap / 60)} min`,
        [userId],
      );
    }
  }
  return null;
}
