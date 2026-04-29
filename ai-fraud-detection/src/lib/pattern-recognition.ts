// =============================================================================
// Pattern recognition — higher-level fraud archetypes
//
// Each pattern is a tiny rule built on top of the same tables the anomaly
// detectors use. They are checked independently; runner.combines matches.
// =============================================================================

import type { ServiceDeps } from './service-container.js';

export type FraudPattern =
  | 'card_testing'
  | 'bulk_resale_prep'
  | 'refund_then_chargeback'
  | 'first_purchase_high_value'
  | 'account_takeover'
  | 'promo_code_farming';

export interface PatternMatch {
  pattern: FraudPattern;
  confidence: number;
  evidence: string[];
  linkedEntityIds: string[];
}

function toInt(v: unknown): number {
  if (typeof v === 'number') return v;
  if (typeof v === 'string') return parseInt(v, 10) || 0;
  return 0;
}

// ---------------------------------------------------------------------------
// Individual pattern checks
// ---------------------------------------------------------------------------

async function cardTestingForUser(
  userId: string,
  deps: ServiceDeps,
): Promise<PatternMatch | null> {
  // 3+ small charges (<5000 hellers = 50 Kč) in 10 minutes, same card
  const rows = await deps.db.query<{
    card_fingerprint: string;
    cnt: number;
    payment_ids: string[];
  }>(
    `SELECT p.card_fingerprint,
            COUNT(*)::int AS cnt,
            ARRAY_AGG(p.id::text) AS payment_ids
     FROM payments.payments p
     JOIN orders.orders o ON o.id = p.order_id
     WHERE o.user_id = $1
       AND p.amount_hellers < 5000
       AND p.created_at > NOW() - INTERVAL '10 minutes'
     GROUP BY p.card_fingerprint
     HAVING COUNT(*) >= 3`,
    [userId],
  );
  if (rows.length === 0) return null;
  const row = rows[0]!;
  return {
    pattern: 'card_testing',
    confidence: 90,
    evidence: [`${row.cnt} small charges on card ${row.card_fingerprint.slice(0, 8)}… in 10 min`],
    linkedEntityIds: row.payment_ids,
  };
}

async function bulkResalePrepForUser(
  userId: string,
  deps: ServiceDeps,
): Promise<PatternMatch | null> {
  const rows = await deps.db.query<{ event_id: string; cnt: number; order_ids: string[] }>(
    `SELECT event_id, COUNT(*)::int AS cnt, ARRAY_AGG(id::text) AS order_ids
     FROM orders.orders
     WHERE user_id = $1 AND event_id IS NOT NULL
       AND created_at > NOW() - INTERVAL '10 minutes'
     GROUP BY event_id
     HAVING COUNT(*) >= 5`,
    [userId],
  );
  if (rows.length === 0) return null;
  const r = rows[0]!;
  return {
    pattern: 'bulk_resale_prep',
    confidence: 80,
    evidence: [`${r.cnt} orders for event ${r.event_id} in 10 min`],
    linkedEntityIds: r.order_ids,
  };
}

async function refundThenChargeback(
  userId: string,
  deps: ServiceDeps,
): Promise<PatternMatch | null> {
  const [row] = await deps.db.query<{ cnt: number; order_ids: string[] | null }>(
    `SELECT COUNT(*)::int AS cnt, ARRAY_AGG(o.id::text) AS order_ids
     FROM orders.orders o
     JOIN orders.refunds r ON r.order_id = o.id
     JOIN payments.payments p ON p.order_id = o.id
     WHERE o.user_id = $1
       AND p.status = 'chargeback'
       AND r.refunded_at > NOW() - INTERVAL '90 days'`,
    [userId],
  );
  const cnt = toInt(row?.cnt);
  if (cnt < 2) return null;
  return {
    pattern: 'refund_then_chargeback',
    confidence: 85,
    evidence: [`${cnt} orders with both refund and chargeback`],
    linkedEntityIds: row?.order_ids ?? [],
  };
}

async function firstPurchaseHighValueForUser(
  userId: string,
  deps: ServiceDeps,
): Promise<PatternMatch | null> {
  const [row] = await deps.db.query<{
    user_id: string;
    account_age_minutes: string | null;
    total_hellers: number | null;
    order_id: string | null;
  }>(
    `SELECT u.id AS user_id,
            EXTRACT(EPOCH FROM (NOW() - u.created_at)) / 60 AS account_age_minutes,
            o.total_hellers,
            o.id::text AS order_id
     FROM accounts.users u
     LEFT JOIN LATERAL (
       SELECT id, total_hellers FROM orders.orders
       WHERE user_id = u.id ORDER BY created_at ASC LIMIT 1
     ) o ON TRUE
     WHERE u.id = $1`,
    [userId],
  );
  if (!row || !row.order_id) return null;
  const ageMin = row.account_age_minutes ? parseFloat(row.account_age_minutes) : Infinity;
  const total = row.total_hellers ?? 0;
  // account younger than 60 min and first order > 5000 Kč (500_000 hellers)
  if (ageMin < 60 && total > 500_000) {
    return {
      pattern: 'first_purchase_high_value',
      confidence: 75,
      evidence: [`Account age ${Math.round(ageMin)}min, first order ${total} hellers`],
      linkedEntityIds: [row.order_id],
    };
  }
  return null;
}

async function accountTakeoverForUser(
  userId: string,
  deps: ServiceDeps,
): Promise<PatternMatch | null> {
  const [row] = await deps.db.query<{
    dormant_days: string | null;
    new_device: boolean | null;
    order_id: string | null;
  }>(
    `SELECT EXTRACT(EPOCH FROM (o.created_at - u.last_login_at)) / 86400 AS dormant_days,
            NOT EXISTS (
              SELECT 1 FROM risk.device_fingerprints df
              WHERE df.user_id = u.id
                AND df.fingerprint_hash = (
                  SELECT fingerprint_hash FROM risk.device_fingerprints
                  WHERE order_id = o.id LIMIT 1
                )
                AND df.seen_at < u.last_login_at
            ) AS new_device,
            o.id::text AS order_id
     FROM accounts.users u
     JOIN LATERAL (
       SELECT id, created_at FROM orders.orders
       WHERE user_id = u.id ORDER BY created_at DESC LIMIT 1
     ) o ON TRUE
     WHERE u.id = $1`,
    [userId],
  );
  const days = row?.dormant_days ? parseFloat(row.dormant_days) : 0;
  if (days >= 90 && row?.new_device && row.order_id) {
    return {
      pattern: 'account_takeover',
      confidence: 70,
      evidence: [`${Math.round(days)} days dormant, order from new device`],
      linkedEntityIds: [row.order_id],
    };
  }
  return null;
}

async function promoCodeFarmingForUser(
  userId: string,
  deps: ServiceDeps,
): Promise<PatternMatch | null> {
  const rows = await deps.db.query<{ promo_code: string; cnt: number; user_ids: string[] }>(
    `SELECT o.promo_code,
            COUNT(DISTINCT o.user_id)::int AS cnt,
            ARRAY_AGG(DISTINCT o.user_id::text) AS user_ids
     FROM orders.orders o
     WHERE o.promo_code IS NOT NULL
       AND o.created_at > NOW() - INTERVAL '7 days'
       AND o.ip_address = (SELECT ip_address FROM orders.orders WHERE user_id = $1 ORDER BY created_at DESC LIMIT 1)
     GROUP BY o.promo_code
     HAVING COUNT(DISTINCT o.user_id) >= 10`,
    [userId],
  );
  if (rows.length === 0) return null;
  const r = rows[0]!;
  return {
    pattern: 'promo_code_farming',
    confidence: 85,
    evidence: [`Promo ${r.promo_code} used by ${r.cnt} accounts from same IP`],
    linkedEntityIds: r.user_ids,
  };
}

// ---------------------------------------------------------------------------
// Public entry point
// ---------------------------------------------------------------------------

export async function detectPatterns(
  subjectType: 'order' | 'user',
  subjectId: string,
  deps: ServiceDeps,
): Promise<PatternMatch[]> {
  // Resolve to userId for all checks
  let userId = subjectId;
  if (subjectType === 'order') {
    const [row] = await deps.db.query<{ user_id: string }>(
      `SELECT user_id FROM orders.orders WHERE id = $1`,
      [subjectId],
    );
    if (!row) return [];
    userId = row.user_id;
  }

  const results = await Promise.all([
    cardTestingForUser(userId, deps),
    bulkResalePrepForUser(userId, deps),
    refundThenChargeback(userId, deps),
    firstPurchaseHighValueForUser(userId, deps),
    accountTakeoverForUser(userId, deps),
    promoCodeFarmingForUser(userId, deps),
  ]);

  return results.filter((x): x is PatternMatch => x !== null);
}
