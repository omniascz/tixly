/**
 * feature.service.ts — Fetches and caches user/event features from PostgreSQL
 * (ai.* schema) with a Redis hot-cache layer for frequently accessed data.
 */

import {
  DbAdapter,
  EventFeatures,
  FeatureNotFoundError,
  RedisAdapter,
  UserFeatures,
} from "../types/recommendation.types";

// ─── Cache keys ───────────────────────────────────────────────────────────────

const USER_FEATURES_TTL = 300; // 5 minutes
const userFeatureKey = (userId: string) => `tixly:features:user:${userId}`;

// ─── Row types from PostgreSQL queries ────────────────────────────────────────

interface UserFeaturesRow {
  user_id: string;
  genre_vector: Record<string, number>;
  price_sensitivity: number;
  primary_city: string | null;
  events_browsed_30d: number;
  last_purchase_at: string | null;
  total_purchases: number;
  active_pass_organizer_ids: string[];
  updated_at: string;
}

interface EventFeaturesRow {
  event_id: string;
  category: string;
  venue_city: string;
  organizer_id: string;
  organizer_name: string;
  sell_through_rate: number;
  sales_velocity_24h: number;
  base_price_min_czk: number;
  days_until_event: number;
  is_weekend: boolean;
  days_since_creation: number;
  total_capacity: number;
  updated_at: string;
}

// ─── Mappers ──────────────────────────────────────────────────────────────────

function mapUserFeaturesRow(row: UserFeaturesRow): UserFeatures {
  return {
    userId: row.user_id,
    genreVector: row.genre_vector ?? {},
    priceSensitivity: row.price_sensitivity ?? 0.5,
    primaryCity: row.primary_city ?? null,
    eventsBrowsed30d: row.events_browsed_30d ?? 0,
    lastPurchaseAt: row.last_purchase_at ? new Date(row.last_purchase_at) : null,
    totalPurchases: row.total_purchases ?? 0,
    activePassOrganizerIds: row.active_pass_organizer_ids ?? [],
    updatedAt: new Date(row.updated_at),
  };
}

function mapEventFeaturesRow(row: EventFeaturesRow): EventFeatures {
  return {
    eventId: row.event_id,
    category: row.category,
    venueCity: row.venue_city,
    organizerId: row.organizer_id,
    organizerName: row.organizer_name,
    sellThroughRate: row.sell_through_rate ?? 0,
    salesVelocity24h: row.sales_velocity_24h ?? 0,
    basePriceMinCzk: row.base_price_min_czk ?? 0,
    daysUntilEvent: row.days_until_event ?? 0,
    isWeekend: row.is_weekend ?? false,
    daysSinceCreation: row.days_since_creation ?? 0,
    totalCapacity: row.total_capacity ?? 0,
    updatedAt: new Date(row.updated_at),
  };
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Fetches user features from Redis cache (TTL 5 min) or falls back to
 * PostgreSQL. Returns null when the user has no feature record yet.
 */
export async function getUserFeatures(
  userId: string,
  db: DbAdapter,
  redis: RedisAdapter,
): Promise<UserFeatures | null> {
  const cacheKey = userFeatureKey(userId);

  // 1. Try Redis cache
  const cached = await redis.get(cacheKey);
  if (cached !== null) {
    try {
      const parsed = JSON.parse(cached) as UserFeaturesRow;
      return mapUserFeaturesRow(parsed);
    } catch {
      // Corrupt cache entry — fall through to DB
    }
  }

  // 2. Fetch from PostgreSQL
  const rows = await db.query<UserFeaturesRow>(
    `SELECT
       user_id,
       genre_vector,
       price_sensitivity,
       primary_city,
       events_browsed_30d,
       last_purchase_at,
       total_purchases,
       active_pass_organizer_ids,
       updated_at
     FROM ai.user_features
     WHERE user_id = $1`,
    [userId],
  );

  if (!rows || rows.length === 0) return null;

  const features = mapUserFeaturesRow(rows[0]);

  // 3. Populate cache asynchronously (fire-and-forget, don't block caller)
  redis
    .set(cacheKey, JSON.stringify(rows[0]), USER_FEATURES_TTL)
    .catch(() => {
      // Cache write failure is non-fatal
    });

  return features;
}

/**
 * Fetches event features for a batch of event IDs from PostgreSQL.
 * Returns a Map keyed by eventId for O(1) lookup.
 */
export async function getEventFeatures(
  eventIds: string[],
  db: DbAdapter,
): Promise<Map<string, EventFeatures>> {
  if (eventIds.length === 0) return new Map();

  // PostgreSQL array binding: $1 = ARRAY['id1','id2',...]
  const placeholders = eventIds.map((_, i) => `$${i + 1}`).join(", ");

  const rows = await db.query<EventFeaturesRow>(
    `SELECT
       event_id,
       category,
       venue_city,
       organizer_id,
       organizer_name,
       sell_through_rate,
       sales_velocity_24h,
       base_price_min_czk,
       EXTRACT(DAY FROM (event_start_at - NOW()))::int AS days_until_event,
       CASE WHEN EXTRACT(DOW FROM event_start_at) IN (0, 6) THEN true ELSE false END AS is_weekend,
       EXTRACT(DAY FROM (NOW() - created_at))::int AS days_since_creation,
       total_capacity,
       updated_at
     FROM ai.event_features
     WHERE event_id IN (${placeholders})`,
    eventIds,
  );

  const result = new Map<string, EventFeatures>();
  for (const row of rows) {
    result.set(row.event_id, mapEventFeaturesRow(row));
  }
  return result;
}

/**
 * Fetches candidate events for scoring:
 * - Only future events (days_until_event > 0)
 * - Only events with available capacity (sell_through_rate < 1.0)
 * - Ordered by sales velocity (most popular first) for quality candidates
 * - Over-fetches by 3× to allow diversity enforcement to work
 */
export async function getCandidateEvents(
  userFeatures: UserFeatures,
  db: DbAdapter,
  limit: number,
): Promise<EventFeatures[]> {
  const fetchLimit = limit * 3;

  const rows = await db.query<EventFeaturesRow>(
    `SELECT
       event_id,
       category,
       venue_city,
       organizer_id,
       organizer_name,
       sell_through_rate,
       sales_velocity_24h,
       base_price_min_czk,
       EXTRACT(DAY FROM (event_start_at - NOW()))::int AS days_until_event,
       CASE WHEN EXTRACT(DOW FROM event_start_at) IN (0, 6) THEN true ELSE false END AS is_weekend,
       EXTRACT(DAY FROM (NOW() - created_at))::int AS days_since_creation,
       total_capacity,
       updated_at
     FROM ai.event_features
     WHERE days_until_event > 0
       AND sell_through_rate < 1.0
     ORDER BY sales_velocity_24h DESC
     LIMIT $1`,
    [fetchLimit],
  );

  // Bias towards user's city by moving matching events to the front,
  // while keeping the overall sales-velocity ordering within each group.
  const cityEvents: EventFeatures[] = [];
  const otherEvents: EventFeatures[] = [];

  for (const row of rows) {
    const features = mapEventFeaturesRow(row);
    if (
      userFeatures.primaryCity !== null &&
      features.venueCity === userFeatures.primaryCity
    ) {
      cityEvents.push(features);
    } else {
      otherEvents.push(features);
    }
  }

  return [...cityEvents, ...otherEvents];
}

/**
 * Returns the set of event IDs the user has already purchased.
 * Used by the business-rules post-filter to avoid recommending duplicates.
 */
export async function getUserPurchasedEventIds(
  userId: string,
  db: DbAdapter,
): Promise<Set<string>> {
  interface Row {
    event_id: string;
  }

  const rows = await db.query<Row>(
    `SELECT DISTINCT event_id
     FROM orders
     WHERE user_id = $1
       AND status = 'completed'`,
    [userId],
  );

  return new Set(rows.map((r) => r.event_id));
}

/**
 * Fetches user features and throws FeatureNotFoundError when missing.
 * Convenience wrapper used by the batch job.
 */
export async function getUserFeaturesOrThrow(
  userId: string,
  db: DbAdapter,
  redis: RedisAdapter,
): Promise<UserFeatures> {
  const features = await getUserFeatures(userId, db, redis);
  if (features === null) throw new FeatureNotFoundError(userId);
  return features;
}
