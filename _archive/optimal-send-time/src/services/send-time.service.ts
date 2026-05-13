/**
 * Send-time service
 *
 * Orchestrates the Bayesian model, DB persistence and Redis caching.
 */

import {
  initHourPosteriors,
  initDayPosteriors,
  applyEngagementEvents,
  getBestHour,
  getBestDay,
  normalizeToDistribution,
  calculateConfidence,
  isCohortFallback,
} from '../lib/bayesian-model';

import type {
  DbAdapter,
  RedisAdapter,
  UserSendTime,
  EmailEngagementEvent,
  SendTimeRecommendation,
} from '../types/send-time.types';

// ---------------------------------------------------------------------------
// Internal constants
// ---------------------------------------------------------------------------

const MODEL_VERSION = '1.0.0';

/** Redis cache TTL: 24 hours — refreshed daily by the batch job */
const CACHE_TTL_SECONDS = 86_400;

/** Recompute if the stored record is older than 48 h */
const STALE_THRESHOLD_MS = 48 * 60 * 60 * 1000;

/** Maximum concurrent computations in getBatchSendTimes */
const MAX_CONCURRENT_COMPUTATIONS = 10;

function cacheKey(userId: string): string {
  return `tixly:sendtime:user:${userId}`;
}

// ---------------------------------------------------------------------------
// Core computation
// ---------------------------------------------------------------------------

/**
 * Compute (or recompute) the optimal send-time model for a single user.
 *
 * Steps:
 *  1. Fetch the last 365 days of 'opened' and 'delivered' events from the DB.
 *  2. Initialise Beta distributions from cohort priors.
 *  3. Apply all engagement events as Bayesian updates.
 *  4. Derive best_hour, best_day, confidence, distributions.
 *  5. UPSERT the result into ai.user_send_times.
 */
export async function computeUserSendTime(
  userId: string,
  db: DbAdapter
): Promise<UserSendTime> {
  // ------------------------------------------------------------------
  // 1. Load engagement history
  // ------------------------------------------------------------------
  const rows = await db.query<{
    hour_of_day: number;
    day_of_week: number;
    event_type: string;
  }>(
    `SELECT hour_of_day, day_of_week, event_type
     FROM ai.email_engagement_log
     WHERE user_id = $1
       AND event_type IN ('opened', 'clicked', 'delivered')
       AND occurred_at >= NOW() - INTERVAL '365 days'
     ORDER BY occurred_at ASC`,
    [userId]
  );

  // ------------------------------------------------------------------
  // 2. Initialise priors
  // ------------------------------------------------------------------
  let hourPosteriors = initHourPosteriors();
  let dayPosteriors  = initDayPosteriors();

  // ------------------------------------------------------------------
  // 3. Map DB rows to model events
  // ------------------------------------------------------------------
  const events = rows.map((r) => ({
    hourOfDay:  r.hour_of_day,
    dayOfWeek:  r.day_of_week,
    // 'opened' and 'clicked' are positive signals; 'delivered' (not opened) is negative
    wasOpened: r.event_type === 'opened' || r.event_type === 'clicked',
  }));

  const updated = applyEngagementEvents(hourPosteriors, dayPosteriors, events);
  hourPosteriors = updated.hourPosteriors;
  dayPosteriors  = updated.dayPosteriors;

  // ------------------------------------------------------------------
  // 4. Derive statistics
  // ------------------------------------------------------------------
  const dataPoints   = events.length;
  const bestHour     = getBestHour(hourPosteriors);
  const bestDay      = getBestDay(dayPosteriors);
  const confidence   = calculateConfidence(dataPoints);
  const isRollback   = isCohortFallback(dataPoints);
  const hourDist     = normalizeToDistribution(hourPosteriors);
  const dayDist      = normalizeToDistribution(dayPosteriors);
  const computedAt   = new Date().toISOString();

  // ------------------------------------------------------------------
  // 5. UPSERT into ai.user_send_times
  // ------------------------------------------------------------------
  await db.execute(
    `INSERT INTO ai.user_send_times
       (user_id, best_send_hour, best_send_day, confidence,
        hour_distribution, day_distribution, data_points,
        is_cohort_fallback, model_version, computed_at)
     VALUES ($1, $2, $3, $4, $5::jsonb, $6::jsonb, $7, $8, $9, $10)
     ON CONFLICT (user_id) DO UPDATE SET
       best_send_hour    = EXCLUDED.best_send_hour,
       best_send_day     = EXCLUDED.best_send_day,
       confidence        = EXCLUDED.confidence,
       hour_distribution = EXCLUDED.hour_distribution,
       day_distribution  = EXCLUDED.day_distribution,
       data_points       = EXCLUDED.data_points,
       is_cohort_fallback = EXCLUDED.is_cohort_fallback,
       model_version     = EXCLUDED.model_version,
       computed_at       = EXCLUDED.computed_at`,
    [
      userId,
      bestHour,
      bestDay,
      confidence,
      JSON.stringify(hourDist),
      JSON.stringify(dayDist),
      dataPoints,
      isRollback,
      MODEL_VERSION,
      computedAt,
    ]
  );

  return {
    userId,
    bestSendHour: bestHour,
    bestSendDay:  bestDay,
    confidence,
    hourDistribution: hourDist,
    dayDistribution:  dayDist,
    dataPoints,
    isCohortFallback: isRollback,
    modelVersion: MODEL_VERSION,
    computedAt,
  };
}

// ---------------------------------------------------------------------------
// Single-user lookup (with cache)
// ---------------------------------------------------------------------------

/**
 * Get a send-time recommendation for one user.
 *
 * Cache strategy:
 *   L1 → Redis (TTL 24h)
 *   L2 → DB row (if row exists AND is < 48 h old)
 *   L3 → full recompute via computeUserSendTime()
 */
export async function getUserSendTime(
  userId: string,
  db: DbAdapter,
  redis: RedisAdapter
): Promise<SendTimeRecommendation> {
  // L1: Redis
  const cached = await redis.get(cacheKey(userId));
  if (cached) {
    return JSON.parse(cached) as SendTimeRecommendation;
  }

  // L2: DB
  const dbRows = await db.query<{
    best_send_hour: number;
    best_send_day:  number;
    confidence:     number;
    hour_distribution: Record<number, number>;
    day_distribution:  Record<number, number>;
    data_points:    number;
    is_cohort_fallback: boolean;
    computed_at:    string;
  }>(
    `SELECT best_send_hour, best_send_day, confidence,
            hour_distribution, day_distribution, data_points,
            is_cohort_fallback, computed_at
     FROM ai.user_send_times
     WHERE user_id = $1`,
    [userId]
  );

  let userSendTime: UserSendTime;

  if (dbRows.length > 0) {
    const row        = dbRows[0];
    const ageMs      = Date.now() - new Date(row.computed_at).getTime();
    const isStale    = ageMs > STALE_THRESHOLD_MS;

    if (isStale) {
      userSendTime = await computeUserSendTime(userId, db);
    } else {
      userSendTime = {
        userId,
        bestSendHour:     row.best_send_hour,
        bestSendDay:      row.best_send_day,
        confidence:       row.confidence,
        hourDistribution: row.hour_distribution,
        dayDistribution:  row.day_distribution,
        dataPoints:       row.data_points,
        isCohortFallback: row.is_cohort_fallback,
        modelVersion:     MODEL_VERSION,
        computedAt:       row.computed_at,
      };
    }
  } else {
    userSendTime = await computeUserSendTime(userId, db);
  }

  const recommendation = toRecommendation(userSendTime);

  // Populate Redis for subsequent requests
  await redis.set(cacheKey(userId), JSON.stringify(recommendation), CACHE_TTL_SECONDS);

  return recommendation;
}

// ---------------------------------------------------------------------------
// Batch lookup
// ---------------------------------------------------------------------------

/**
 * Get send-time recommendations for a list of users.
 *
 * Strategy:
 *  1. Pipeline-fetch all keys from Redis in one round-trip.
 *  2. For cache-miss users: bulk-query DB.
 *  3. For users not in DB at all: compute in parallel (max 10 concurrent).
 *  4. Populate Redis for all computed values.
 *  5. Return results in input order.
 */
export async function getBatchSendTimes(
  userIds: string[],
  db: DbAdapter,
  redis: RedisAdapter
): Promise<SendTimeRecommendation[]> {
  const resultMap = new Map<string, SendTimeRecommendation>();

  // ------------------------------------------------------------------
  // Step 1 — Redis pipeline fetch
  // ------------------------------------------------------------------
  const keys        = userIds.map(cacheKey);
  const cachedValues = await redis.mget(keys);

  const cacheMissIds: string[] = [];
  cachedValues.forEach((val, idx) => {
    if (val !== null) {
      resultMap.set(userIds[idx], JSON.parse(val) as SendTimeRecommendation);
    } else {
      cacheMissIds.push(userIds[idx]);
    }
  });

  if (cacheMissIds.length === 0) {
    return userIds.map((id) => resultMap.get(id)!);
  }

  // ------------------------------------------------------------------
  // Step 2 — Bulk DB query for cache-miss users
  // ------------------------------------------------------------------
  const placeholders = cacheMissIds.map((_, i) => `$${i + 1}`).join(', ');
  const dbRows = await db.query<{
    user_id:           string;
    best_send_hour:    number;
    best_send_day:     number;
    confidence:        number;
    hour_distribution: Record<number, number>;
    day_distribution:  Record<number, number>;
    data_points:       number;
    is_cohort_fallback: boolean;
    computed_at:       string;
  }>(
    `SELECT user_id, best_send_hour, best_send_day, confidence,
            hour_distribution, day_distribution, data_points,
            is_cohort_fallback, computed_at
     FROM ai.user_send_times
     WHERE user_id IN (${placeholders})`,
    cacheMissIds
  );

  const dbMap = new Map(dbRows.map((r) => [r.user_id, r]));

  const needsCompute: string[] = [];
  for (const userId of cacheMissIds) {
    const row = dbMap.get(userId);
    if (!row) {
      needsCompute.push(userId);
      continue;
    }

    const ageMs   = Date.now() - new Date(row.computed_at).getTime();
    const isStale = ageMs > STALE_THRESHOLD_MS;

    if (isStale) {
      needsCompute.push(userId);
    } else {
      const rec: SendTimeRecommendation = {
        userId,
        bestHour:         row.best_send_hour,
        bestDay:          row.best_send_day,
        confidence:       row.confidence,
        hourDistribution: row.hour_distribution,
        dayDistribution:  row.day_distribution,
        isCohortFallback: row.is_cohort_fallback,
      };
      resultMap.set(userId, rec);
      // Re-populate Redis
      await redis.set(cacheKey(userId), JSON.stringify(rec), CACHE_TTL_SECONDS);
    }
  }

  // ------------------------------------------------------------------
  // Step 3 — Parallel computation for users without DB records
  // ------------------------------------------------------------------
  if (needsCompute.length > 0) {
    // Process in batches of MAX_CONCURRENT_COMPUTATIONS
    for (let i = 0; i < needsCompute.length; i += MAX_CONCURRENT_COMPUTATIONS) {
      const batch   = needsCompute.slice(i, i + MAX_CONCURRENT_COMPUTATIONS);
      const results = await Promise.allSettled(
        batch.map((userId) => computeUserSendTime(userId, db))
      );

      for (let j = 0; j < batch.length; j++) {
        const userId = batch[j];
        const result = results[j];

        if (result.status === 'fulfilled') {
          const rec = toRecommendation(result.value);
          resultMap.set(userId, rec);
          await redis.set(cacheKey(userId), JSON.stringify(rec), CACHE_TTL_SECONDS);
        } else {
          // Fall back to cold-start cohort recommendation so the batch always
          // returns something usable even on individual failures.
          resultMap.set(userId, buildCohortFallback(userId));
        }
      }
    }
  }

  return userIds.map((id) => resultMap.get(id) ?? buildCohortFallback(id));
}

// ---------------------------------------------------------------------------
// Engagement event recording
// ---------------------------------------------------------------------------

/**
 * Persist one Mailgun engagement event and invalidate the user's Redis cache.
 */
export async function recordEngagementEvent(
  event: EmailEngagementEvent,
  db: DbAdapter,
  redis: RedisAdapter
): Promise<void> {
  await db.execute(
    `INSERT INTO ai.email_engagement_log
       (user_id, message_id, event_type, occurred_at, hour_of_day, day_of_week,
        campaign_id, subject_line, created_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, NOW())`,
    [
      event.userId,
      event.messageId,
      event.eventType,
      event.occurredAt,
      event.hourOfDay,
      event.dayOfWeek,
      event.campaignId ?? null,
      event.subjectLine ?? null,
    ]
  );

  // Invalidate cache so the next request triggers a fresh computation
  await redis.del(cacheKey(event.userId));
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

function toRecommendation(ust: UserSendTime): SendTimeRecommendation {
  return {
    userId:           ust.userId,
    bestHour:         ust.bestSendHour,
    bestDay:          ust.bestSendDay,
    confidence:       ust.confidence,
    hourDistribution: ust.hourDistribution,
    dayDistribution:  ust.dayDistribution,
    isCohortFallback: ust.isCohortFallback,
  };
}

/**
 * Cohort fallback — used when computation fails and we have nothing in DB.
 * Returns the cohort-prior best hour/day with zero confidence.
 */
function buildCohortFallback(userId: string): SendTimeRecommendation {
  const hourPost = initHourPosteriors();
  const dayPost  = initDayPosteriors();
  return {
    userId,
    bestHour:         getBestHour(hourPost),
    bestDay:          getBestDay(dayPost),
    confidence:       0,
    hourDistribution: normalizeToDistribution(hourPost),
    dayDistribution:  normalizeToDistribution(dayPost),
    isCohortFallback: true,
  };
}
