// =============================================================================
// Segmentation service — evaluate user eligibility for campaigns
//
// Handles matching users against segment rules using AND logic:
// all rules must pass for user to be included.
// =============================================================================

import type { SegmentRule } from '../lib/types.js';

export interface DbAdapter {
  query<T>(sql: string, params?: unknown[]): Promise<T[]>;
  execute(sql: string, params?: unknown[]): Promise<void>;
  transaction<T>(fn: (tx: DbAdapter) => Promise<T>): Promise<T>;
}

/**
 * Age buckets for age-based segmentation
 */
const AGE_BUCKETS = {
  '18-25': { min: 18, max: 25 },
  '26-40': { min: 26, max: 40 },
  '40+': { min: 40, max: 150 },
};

interface UserRow {
  id: string;
  phone_number: string;
  date_of_birth: string | null;
  city: string | null;
  region: string | null;
}

interface UserEventRow {
  user_id: string;
  event_type: string;
}

interface EngagementRow {
  user_id: string;
  engagement_type: string;
}

interface PurchaseHistoryRow {
  user_id: string;
  total_spent: number;
  order_count: number;
  days_since_last_purchase: number;
}

/**
 * Evaluate a single segment rule against a user.
 * Returns true if user matches the rule.
 */
export async function evaluateSegment(
  userId: string,
  rule: SegmentRule,
  db: DbAdapter,
): Promise<boolean> {
  switch (rule.type) {
    case 'event_type':
      return evaluateEventType(userId, rule, db);
    case 'geography':
      return evaluateGeography(userId, rule, db);
    case 'age':
      return evaluateAge(userId, rule, db);
    case 'purchase_history':
      return evaluatePurchaseHistory(userId, rule, db);
    case 'engagement_level':
      return evaluateEngagement(userId, rule, db);
    default:
      return false;
  }
}

/**
 * Evaluate ALL rules for a user (AND logic).
 * User must match every rule to be included.
 */
export async function evaluateSegments(
  userId: string,
  rules: SegmentRule[],
  db: DbAdapter,
): Promise<boolean> {
  if (rules.length === 0) return true; // no rules = include all

  for (const rule of rules) {
    const matches = await evaluateSegment(userId, rule, db);
    if (!matches) return false; // fail fast on first non-match
  }
  return true;
}

/**
 * Get count of users matching all segment rules (for preview/analytics).
 */
export async function getSegmentSize(
  promoterId: string,
  rules: SegmentRule[],
  db: DbAdapter,
): Promise<number> {
  // For simplicity, start with all opted-in users for this promoter's events
  let query = `
    SELECT COUNT(DISTINCT u.id) as count
    FROM users u
    INNER JOIN sms_marketing.sms_optins so ON so.buyer_id = u.id
    INNER JOIN events e ON e.id = so.event_id
    WHERE e.promoter_id = $1
      AND so.opted = true
  `;

  const params: unknown[] = [promoterId];

  // Add rule-based filtering (simplified for each rule type)
  for (let i = 0; i < rules.length; i++) {
    const rule = rules[i];
    const paramIdx = i + 2;

    switch (rule.type) {
      case 'event_type':
        query += ` AND so.event_id IN (
          SELECT id FROM events WHERE event_type = $${paramIdx}
        )`;
        params.push(rule.values[0]);
        break;

      case 'geography':
        query += ` AND u.city = $${paramIdx}`;
        params.push(rule.values[0]);
        break;

      case 'age':
        // Age rule with bucket matching
        const bucket = rule.values[0] as string;
        if (bucket in AGE_BUCKETS) {
          const { min, max } = AGE_BUCKETS[bucket as keyof typeof AGE_BUCKETS];
          query += ` AND EXTRACT(YEAR FROM AGE(u.date_of_birth)) BETWEEN ${min} AND ${max}`;
        }
        break;

      case 'purchase_history':
        // This is simplified; real logic would count orders
        query += ` AND u.id IN (
          SELECT buyer_id FROM orders WHERE promoter_id = $${paramIdx}
        )`;
        params.push(promoterId);
        break;

      case 'engagement_level':
        // Check for specific engagement type
        query += ` AND u.id IN (
          SELECT user_id FROM user_engagement WHERE engagement_type = $${paramIdx}
        )`;
        params.push(rule.values[0]);
        break;
    }
  }

  const rows = await db.query<{ count: number }>(query, params);
  return rows[0]?.count ?? 0;
}

/**
 * Get sample recipients from segment (up to N users).
 */
export async function getSampleRecipients(
  promoterId: string,
  rules: SegmentRule[],
  db: DbAdapter,
  limit: number = 3,
): Promise<Array<{ userId: string; phone: string; eventType?: string; lastPurchaseDate?: string }>> {
  let query = `
    SELECT DISTINCT
      u.id as user_id,
      so.phone_number as phone,
      e.event_type,
      MAX(o.created_at) as last_purchase_date
    FROM users u
    INNER JOIN sms_marketing.sms_optins so ON so.buyer_id = u.id
    INNER JOIN events e ON e.id = so.event_id
    LEFT JOIN orders o ON o.buyer_id = u.id AND o.promoter_id = e.promoter_id
    WHERE e.promoter_id = $1
      AND so.opted = true
  `;

  const params: unknown[] = [promoterId];
  let paramIdx = 2;

  // Add rule filtering
  for (const rule of rules) {
    switch (rule.type) {
      case 'event_type':
        query += ` AND e.event_type = $${paramIdx}`;
        params.push(rule.values[0]);
        paramIdx++;
        break;

      case 'geography':
        query += ` AND u.city = $${paramIdx}`;
        params.push(rule.values[0]);
        paramIdx++;
        break;

      case 'age':
        const bucket = rule.values[0] as string;
        if (bucket in AGE_BUCKETS) {
          const { min, max } = AGE_BUCKETS[bucket as keyof typeof AGE_BUCKETS];
          query += ` AND EXTRACT(YEAR FROM AGE(u.date_of_birth)) BETWEEN ${min} AND ${max}`;
        }
        break;

      case 'engagement_level':
        query += ` AND u.id IN (
          SELECT user_id FROM user_engagement WHERE engagement_type = $${paramIdx}
        )`;
        params.push(rule.values[0]);
        paramIdx++;
        break;
    }
  }

  query += ` GROUP BY u.id, so.phone_number, e.event_type
    ORDER BY last_purchase_date DESC NULLS LAST
    LIMIT $${paramIdx}`;
  params.push(limit);

  const rows = await db.query<{
    user_id: string;
    phone: string;
    event_type: string;
    last_purchase_date: string | null;
  }>(query, params);

  return rows.map(r => ({
    userId: r.user_id,
    phone: r.phone,
    eventType: r.event_type,
    lastPurchaseDate: r.last_purchase_date || undefined,
  }));
}

// =============================================================================
// Private: Rule evaluation helpers
// =============================================================================

async function evaluateEventType(
  userId: string,
  rule: SegmentRule,
  db: DbAdapter,
): Promise<boolean> {
  const rows = await db.query<{ count: number }>(
    `SELECT COUNT(*) as count FROM events e
     INNER JOIN sms_marketing.sms_optins so ON so.event_id = e.id
     WHERE so.buyer_id = $1 AND e.event_type = $2`,
    [userId, rule.values[0]],
  );
  return (rows[0]?.count ?? 0) > 0;
}

async function evaluateGeography(
  userId: string,
  rule: SegmentRule,
  db: DbAdapter,
): Promise<boolean> {
  const rows = await db.query<{ city: string | null }>(
    `SELECT city FROM users WHERE id = $1`,
    [userId],
  );
  const userCity = rows[0]?.city;
  return userCity ? rule.values.includes(userCity) : false;
}

async function evaluateAge(
  userId: string,
  rule: SegmentRule,
  db: DbAdapter,
): Promise<boolean> {
  const rows = await db.query<{ date_of_birth: string | null }>(
    `SELECT date_of_birth FROM users WHERE id = $1`,
    [userId],
  );
  const dob = rows[0]?.date_of_birth;
  if (!dob) return false;

  const bucket = rule.values[0] as string;
  if (!(bucket in AGE_BUCKETS)) return false;

  const { min, max } = AGE_BUCKETS[bucket as keyof typeof AGE_BUCKETS];
  const birthDate = new Date(dob);
  const today = new Date();
  const age = today.getFullYear() - birthDate.getFullYear();

  return age >= min && age <= max;
}

async function evaluatePurchaseHistory(
  userId: string,
  rule: SegmentRule,
  db: DbAdapter,
): Promise<boolean> {
  const category = rule.values[0]; // high_spender, repeat, one_time, inactive

  if (category === 'high_spender') {
    const rows = await db.query<{ total: number }>(
      `SELECT COALESCE(SUM(total_price), 0) as total FROM orders WHERE buyer_id = $1`,
      [userId],
    );
    // Consider high spender if total > 5000 CZK
    return (rows[0]?.total ?? 0) > 5000;
  }

  if (category === 'repeat') {
    const rows = await db.query<{ count: number }>(
      `SELECT COUNT(*) as count FROM orders WHERE buyer_id = $1`,
      [userId],
    );
    return (rows[0]?.count ?? 0) >= 2;
  }

  if (category === 'one_time') {
    const rows = await db.query<{ count: number }>(
      `SELECT COUNT(*) as count FROM orders WHERE buyer_id = $1`,
      [userId],
    );
    return (rows[0]?.count ?? 0) === 1;
  }

  if (category === 'inactive') {
    const rows = await db.query<{ days_since: number }>(
      `SELECT EXTRACT(DAY FROM NOW() - MAX(created_at)) as days_since FROM orders WHERE buyer_id = $1`,
      [userId],
    );
    // Inactive if no purchase in 180+ days
    return (rows[0]?.days_since ?? 0) >= 180;
  }

  return false;
}

async function evaluateEngagement(
  userId: string,
  rule: SegmentRule,
  db: DbAdapter,
): Promise<boolean> {
  const engagementType = rule.values[0]; // opened_email, attended_event, referred_friend

  const rows = await db.query<{ count: number }>(
    `SELECT COUNT(*) as count FROM user_engagement
     WHERE user_id = $1 AND engagement_type = $2`,
    [userId, engagementType],
  );
  return (rows[0]?.count ?? 0) > 0;
}
