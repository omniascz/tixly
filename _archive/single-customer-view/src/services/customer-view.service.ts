/**
 * customer-view.service.ts — 360° zákaznický profil.
 *
 * Agreguje data z identity, orders, loyalty, segmentation, referral,
 * risk a blacklist schémat do jediného profilu.
 */

import type {
  CustomerProfile,
  CustomerOrderHistory,
  CustomerTimeline,
  Pagination,
} from '../types/customer-view.js';
import { CustomerNotFoundError } from '../types/customer-view.js';
import type { DbAdapter } from '@tixly/rls-multitenancy';
import { withTenantContext } from '@tixly/rls-multitenancy';

// ─── RFM scoring (inline thresholds from dynamic-cashback) ───────────────────

type Score = 1 | 2 | 3 | 4 | 5;

function scoreRecency(days: number): Score {
  if (days <= 7) return 5;
  if (days <= 30) return 4;
  if (days <= 90) return 3;
  if (days <= 180) return 2;
  return 1;
}

function scoreFrequency(count: number): Score {
  if (count >= 10) return 5;
  if (count >= 5) return 4;
  if (count >= 3) return 3;
  if (count >= 2) return 2;
  return 1;
}

function scoreMonetary(halire: number): Score {
  if (halire >= 1_000_000) return 5;
  if (halire >= 500_000) return 4;
  if (halire >= 200_000) return 3;
  if (halire >= 100_000) return 2;
  return 1;
}

function determineCohort(r: number, f: number, m: number): string {
  if (r >= 4 && f >= 4 && m >= 4) return 'champion';
  if (r >= 2 && r <= 3 && f >= 4 && m >= 4) return 'at_risk';
  if (f >= 4) return 'loyal';
  if (r >= 4 && f === 1) return 'new';
  if (r >= 4 && f >= 2 && f <= 3 && m >= 2 && m <= 3) return 'potential';
  if (r <= 2 && f >= 2 && f <= 3) return 'hibernating';
  if (r === 1 && f <= 2) return 'lost';
  if (r >= 4) return 'potential';
  if (r <= 1) return 'lost';
  return 'hibernating';
}

// ─── Dependencies ────────────────────────────────────────────────────────────

export interface ServiceDeps {
  db: DbAdapter;
}

// ─── DB row types ────────────────────────────────────────────────────────────

interface UserRow {
  id: string;
  email: string;
  first_name: string | null;
  last_name: string | null;
  phone: string | null;
  created_at: string;
}

interface LtvRow {
  order_count: string;
  total_halire: string;
  max_created_at: string | null;
  ticket_count: string;
  events_attended: string;
}

interface RefundRow {
  refund_count: string;
  refunded_halire: string;
}

interface LoyaltyRow {
  tier: string;
  points_balance: string;
}

interface SegmentRow {
  segment_id: string;
}

interface ReferralRow {
  code: string;
  conversion_count: string;
}

interface FraudRow {
  total_score: number;
}

interface BlacklistRow {
  exists: number;
}

interface CountRow {
  count: string;
}

// ─── getCustomerProfile ──────────────────────────────────────────────────────

export async function getCustomerProfile(
  userId: string,
  promoterId: string,
  deps: ServiceDeps,
): Promise<CustomerProfile> {
  const { db } = deps;

  // 1. User basic info
  const userRows = await withTenantContext(db, promoterId, (client) =>
    client.query<UserRow>(
      `SELECT id, email, first_name, last_name, phone, created_at
       FROM identity.users
       WHERE id = $1
       LIMIT 1`,
      [userId],
    ),
  );

  if (userRows.rows.length === 0) {
    throw new CustomerNotFoundError(userId);
  }

  const user = userRows.rows[0];

  // 2-8. Batch remaining queries in parallel
  const [ltvResult, refundResult, loyaltyResult, segmentResult, referralResult, fraudResult, blacklistResult, lastEventResult] =
    await Promise.all([
      // 2. LTV aggregation
      withTenantContext(db, promoterId, (client) =>
        client.query<LtvRow>(
          `SELECT
             COUNT(*)::text AS order_count,
             COALESCE(SUM(total_amount_halire), 0)::text AS total_halire,
             MAX(created_at)::text AS max_created_at,
             COALESCE(SUM(ticket_count), 0)::text AS ticket_count,
             COUNT(DISTINCT event_id)::text AS events_attended
           FROM orders.orders
           WHERE user_id = $1 AND promoter_id = $2 AND status = 'paid'`,
          [userId, promoterId],
        ),
      ),
      // Refunds
      withTenantContext(db, promoterId, (client) =>
        client.query<RefundRow>(
          `SELECT
             COUNT(*)::text AS refund_count,
             COALESCE(SUM(refund_amount_halire), 0)::text AS refunded_halire
           FROM orders.refunds
           WHERE user_id = $1 AND promoter_id = $2`,
          [userId, promoterId],
        ),
      ),
      // 4. Loyalty
      withTenantContext(db, promoterId, (client) =>
        client.query<LoyaltyRow>(
          `SELECT tier, points_balance::text
           FROM loyalty.accounts
           WHERE user_id = $1
           LIMIT 1`,
          [userId],
        ),
      ),
      // 5. Segments
      withTenantContext(db, promoterId, (client) =>
        client.query<SegmentRow>(
          `SELECT segment_id
           FROM segmentation.segment_members
           WHERE user_id = $1`,
          [userId],
        ),
      ),
      // 6. Referral
      withTenantContext(db, promoterId, (client) =>
        client.query<ReferralRow>(
          `SELECT
             rl.code,
             (SELECT COUNT(*)::text FROM referral.conversions WHERE referrer_user_id = $1) AS conversion_count
           FROM referral.referral_links rl
           WHERE rl.user_id = $1
           LIMIT 1`,
          [userId],
        ),
      ),
      // 7. Fraud
      withTenantContext(db, promoterId, (client) =>
        client.query<FraudRow>(
          `SELECT total_score
           FROM risk.detection_runs
           WHERE subject_type = 'user' AND subject_id = $1
           ORDER BY ran_at DESC
           LIMIT 1`,
          [userId],
        ),
      ),
      // 8. Blacklist
      withTenantContext(db, promoterId, (client) =>
        client.query<BlacklistRow>(
          `SELECT 1 AS exists
           FROM blacklist.blacklist_entries
           WHERE identifier = $1 AND scope IN ('promoter', 'platform')
           LIMIT 1`,
          [user.email],
        ),
      ),
      // Last event attended
      withTenantContext(db, promoterId, (client) =>
        client.query<{ last_attended: string | null }>(
          `SELECT MAX(scanned_at)::text AS last_attended
           FROM tickets.scans
           WHERE user_id = $1`,
          [userId],
        ),
      ),
    ]);

  // Parse LTV
  const ltv = ltvResult.rows[0];
  const orderCount = parseInt(ltv.order_count, 10);
  const totalHalire = parseInt(ltv.total_halire, 10);
  const lastPurchaseAt = ltv.max_created_at ? new Date(ltv.max_created_at) : null;
  const ticketCount = parseInt(ltv.ticket_count, 10);
  const eventsAttended = parseInt(ltv.events_attended, 10);
  const avgOrderValue = orderCount > 0 ? Math.round(totalHalire / orderCount) : 0;

  // Refunds
  const refund = refundResult.rows[0];
  const totalRefunds = parseInt(refund.refund_count, 10);
  const totalRefundedHalire = parseInt(refund.refunded_halire, 10);

  // Days since last purchase
  const daysSinceLastPurchase = lastPurchaseAt
    ? Math.floor((Date.now() - lastPurchaseAt.getTime()) / (1000 * 60 * 60 * 24))
    : null;

  // RFM scoring
  const recencyDays = daysSinceLastPurchase ?? 999;
  const recency = scoreRecency(recencyDays);
  const frequency = scoreFrequency(orderCount);
  const monetary = scoreMonetary(totalHalire);
  const cohort = determineCohort(recency, frequency, monetary);

  // Loyalty
  const loyaltyRow = loyaltyResult.rows[0];
  const loyaltyTier = loyaltyRow?.tier ?? 'bronze';
  const loyaltyPointsBalance = loyaltyRow ? parseInt(loyaltyRow.points_balance, 10) : 0;

  // Segments
  const segmentIds = segmentResult.rows.map((r) => r.segment_id);

  // Referral
  const referralRow = referralResult.rows[0];
  const referralCode = referralRow?.code ?? null;
  const referralConversions = referralRow ? parseInt(referralRow.conversion_count, 10) : 0;

  // Fraud
  const fraudRiskScore = fraudResult.rows[0]?.total_score ?? null;

  // Blacklist
  const isBlacklisted = blacklistResult.rows.length > 0;

  // Last event attended
  const lastEventAttendedAt = lastEventResult.rows[0]?.last_attended
    ? new Date(lastEventResult.rows[0].last_attended)
    : null;

  const name = [user.first_name, user.last_name].filter(Boolean).join(' ') || user.email;

  return {
    userId: user.id,
    email: user.email,
    name,
    phone: user.phone,
    registeredAt: new Date(user.created_at),
    lifetimeValueHalire: totalHalire,
    lifetimeOrderCount: orderCount,
    avgOrderValueHalire: avgOrderValue,
    rfm: { recency, frequency, monetary, cohort },
    loyaltyTier,
    loyaltyPointsBalance,
    lastPurchaseAt,
    lastEventAttendedAt,
    daysSinceLastPurchase,
    segmentIds,
    totalTicketsBought: ticketCount,
    totalEventsAttended: eventsAttended,
    totalRefunds,
    totalRefundedHalire,
    referralCode,
    referralConversions,
    fraudRiskScore,
    isBlacklisted,
  };
}

// ─── getOrderHistory ─────────────────────────────────────────────────────────

export async function getOrderHistory(
  userId: string,
  promoterId: string,
  pagination: Pagination,
  deps: ServiceDeps,
): Promise<{ items: CustomerOrderHistory[]; total: number }> {
  const { db } = deps;

  const [dataResult, countResult] = await Promise.all([
    withTenantContext(db, promoterId, (client) =>
      client.query(
        `SELECT
           o.id AS order_id,
           o.order_number,
           e.name AS event_name,
           e.start_date AS event_date,
           o.total_amount_halire AS total_halire,
           o.ticket_count,
           o.status,
           o.created_at
         FROM orders.orders o
         LEFT JOIN catalog.events e ON e.id = o.event_id
         WHERE o.user_id = $1 AND o.promoter_id = $2
         ORDER BY o.created_at DESC
         LIMIT $3 OFFSET $4`,
        [userId, promoterId, pagination.limit, pagination.offset],
      ),
    ),
    withTenantContext(db, promoterId, (client) =>
      client.query<CountRow>(
        `SELECT COUNT(*)::text AS count
         FROM orders.orders
         WHERE user_id = $1 AND promoter_id = $2`,
        [userId, promoterId],
      ),
    ),
  ]);

  const items: CustomerOrderHistory[] = dataResult.rows.map((r: Record<string, unknown>) => ({
    orderId: r.order_id as string,
    orderNumber: r.order_number as string,
    eventName: r.event_name as string,
    eventDate: new Date(r.event_date as string),
    totalHalire: r.total_halire as number,
    ticketCount: r.ticket_count as number,
    status: r.status as string,
    createdAt: new Date(r.created_at as string),
  }));

  return {
    items,
    total: parseInt(countResult.rows[0].count, 10),
  };
}

// ─── getTimeline ─────────────────────────────────────────────────────────────

export async function getTimeline(
  userId: string,
  promoterId: string,
  pagination: Pagination,
  deps: ServiceDeps,
): Promise<{ items: CustomerTimeline[]; total: number }> {
  const { db } = deps;

  // Unify multiple event sources into a single timeline via UNION ALL
  const timelineQuery = `
    SELECT type, description, amount_halire, occurred_at, metadata
    FROM (
      SELECT
        'purchase'::text AS type,
        'Nákup objednávky ' || o.order_number AS description,
        o.total_amount_halire AS amount_halire,
        o.created_at AS occurred_at,
        jsonb_build_object('orderId', o.id) AS metadata
      FROM orders.orders o
      WHERE o.user_id = $1 AND o.promoter_id = $2

      UNION ALL

      SELECT
        'refund'::text AS type,
        'Refundace objednávky ' || r.order_id AS description,
        r.refund_amount_halire AS amount_halire,
        r.created_at AS occurred_at,
        jsonb_build_object('orderId', r.order_id) AS metadata
      FROM orders.refunds r
      WHERE r.user_id = $1 AND r.promoter_id = $2

      UNION ALL

      SELECT
        'ticket_scan'::text AS type,
        'Sken vstupenky' AS description,
        NULL::integer AS amount_halire,
        s.scanned_at AS occurred_at,
        jsonb_build_object('ticketId', s.ticket_id) AS metadata
      FROM tickets.scans s
      WHERE s.user_id = $1

      UNION ALL

      SELECT
        'loyalty_redemption'::text AS type,
        'Uplatnění věrnostních bodů' AS description,
        t.amount_halire AS amount_halire,
        t.created_at AS occurred_at,
        jsonb_build_object('transactionId', t.id) AS metadata
      FROM loyalty.transactions t
      WHERE t.user_id = $1 AND t.type = 'redemption'
    ) AS timeline
    ORDER BY occurred_at DESC
    LIMIT $3 OFFSET $4
  `;

  const countQuery = `
    SELECT (
      (SELECT COUNT(*) FROM orders.orders WHERE user_id = $1 AND promoter_id = $2) +
      (SELECT COUNT(*) FROM orders.refunds WHERE user_id = $1 AND promoter_id = $2) +
      (SELECT COUNT(*) FROM tickets.scans WHERE user_id = $1) +
      (SELECT COUNT(*) FROM loyalty.transactions WHERE user_id = $1 AND type = 'redemption')
    )::text AS count
  `;

  const [dataResult, countResult] = await Promise.all([
    withTenantContext(db, promoterId, (client) =>
      client.query(timelineQuery, [userId, promoterId, pagination.limit, pagination.offset]),
    ),
    withTenantContext(db, promoterId, (client) =>
      client.query<CountRow>(countQuery, [userId, promoterId]),
    ),
  ]);

  const items: CustomerTimeline[] = dataResult.rows.map((r: Record<string, unknown>) => ({
    type: r.type as CustomerTimeline['type'],
    description: r.description as string,
    amountHalire: (r.amount_halire as number) ?? null,
    occurredAt: new Date(r.occurred_at as string),
    metadata: (r.metadata as Record<string, unknown>) ?? {},
  }));

  return {
    items,
    total: parseInt(countResult.rows[0].count, 10),
  };
}

// ─── searchCustomers ─────────────────────────────────────────────────────────

export async function searchCustomers(
  promoterId: string,
  query: string,
  pagination: Pagination,
  deps: ServiceDeps,
): Promise<{ items: CustomerProfile[]; total: number }> {
  const { db } = deps;

  // Search by name or email (ILIKE)
  const searchPattern = `%${query}%`;

  const userRows = await withTenantContext(db, promoterId, (client) =>
    client.query<UserRow & { total_count: string }>(
      `SELECT u.id, u.email, u.first_name, u.last_name, u.phone, u.created_at,
              COUNT(*) OVER() AS total_count
       FROM identity.users u
       INNER JOIN orders.orders o ON o.user_id = u.id AND o.promoter_id = $1
       WHERE (u.email ILIKE $2 OR u.first_name ILIKE $2 OR u.last_name ILIKE $2)
       GROUP BY u.id, u.email, u.first_name, u.last_name, u.phone, u.created_at
       ORDER BY u.last_name, u.first_name
       LIMIT $3 OFFSET $4`,
      [promoterId, searchPattern, pagination.limit, pagination.offset],
    ),
  );

  if (userRows.rows.length === 0) {
    return { items: [], total: 0 };
  }

  const total = parseInt(userRows.rows[0].total_count, 10);

  // Build full profiles for each matched user
  const items = await Promise.all(
    userRows.rows.map((row) => getCustomerProfile(row.id, promoterId, deps)),
  );

  return { items, total };
}
