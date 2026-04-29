/**
 * recommendation-batch.job.ts — Hourly batch job that pre-computes
 * recommendations for all active users and persists them to
 * ai.user_recommendations.
 *
 * Active user = had at least 1 purchase or browsing event in the last 90 days.
 *
 * Processing strategy:
 *   - Fetches users in pages of BATCH_SIZE (default 100)
 *   - Each user is scored independently; a single user failure does not halt
 *     the batch
 *   - Respects SIGINT/SIGTERM for graceful shutdown mid-batch
 */

import {
  getCandidateEvents,
  getUserFeatures,
  getUserPurchasedEventIds,
} from "../services/feature.service";
import {
  cacheRecommendations,
} from "../services/recommendation.service";
import { applyBusinessRules } from "../lib/business-rules";
import {
  assignExplanation,
  calculateExplorationBonus,
  calculateFinalScore,
  calculateGenreSimilarity,
  calculatePopularityScore,
  calculatePriceMatch,
  calculateRecencyBoost,
} from "../lib/scoring";
import {
  BusinessRulesContext,
  DbAdapter,
  DEFAULT_SCORING_WEIGHTS,
  EventFeatures,
  ExplanationKey,
  RankedCandidate,
  RedisAdapter,
  ScoringComponents,
  UserFeatures,
  UserRecommendation,
} from "../types/recommendation.types";

// ─── Configuration ────────────────────────────────────────────────────────────

const BATCH_SIZE = 100;
const CANDIDATE_LIMIT = 200;
const MODEL_VERSION = "popularity-v1";
const EXPIRES_IN_MS = 2 * 60 * 60 * 1000; // 2 hours
const ACTIVE_USER_WINDOW_DAYS = 90;

// ─── Types ────────────────────────────────────────────────────────────────────

interface BatchJobDeps {
  db: DbAdapter;
  redis: RedisAdapter;
}

interface BatchJobResult {
  totalUsers: number;
  processed: number;
  failed: number;
  durationMs: number;
}

interface ActiveUserRow {
  user_id: string;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function deriveMinMaxPrice(events: EventFeatures[]): { min: number; max: number } {
  if (events.length === 0) return { min: 0, max: 1 };
  const prices = events.map((e) => e.basePriceMinCzk);
  return { min: Math.min(...prices), max: Math.max(...prices) };
}

function deriveMaxVelocity(events: EventFeatures[]): number {
  return Math.max(...events.map((e) => e.salesVelocity24h), 1);
}

function deriveVelocityThreshold(events: EventFeatures[]): number {
  if (events.length === 0) return 1;
  const sorted = [...events].sort((a, b) => b.salesVelocity24h - a.salesVelocity24h);
  const p90Index = Math.floor(sorted.length * 0.1);
  return sorted[p90Index]?.salesVelocity24h ?? 1;
}

async function computeRecommendationsForUser(
  userId: string,
  deps: BatchJobDeps,
): Promise<UserRecommendation[]> {
  const { db, redis } = deps;

  const userFeatures = await getUserFeatures(userId, db, redis);
  if (userFeatures === null) return [];

  const [candidates, purchasedIds] = await Promise.all([
    getCandidateEvents(userFeatures, db, CANDIDATE_LIMIT),
    getUserPurchasedEventIds(userId, db),
  ]);

  if (candidates.length === 0) return [];

  const { min: minPrice, max: maxPrice } = deriveMinMaxPrice(candidates);
  const maxVelocity = deriveMaxVelocity(candidates);
  const velocityThreshold = deriveVelocityThreshold(candidates);

  // Score each candidate
  const scored = candidates.map((event) => {
    const popularityScore = calculatePopularityScore(
      event.sellThroughRate,
      event.salesVelocity24h,
      maxVelocity,
    );
    const genreSimilarity = calculateGenreSimilarity(
      userFeatures.genreVector,
      event.category,
    );
    const locationBonus =
      userFeatures.primaryCity !== null &&
      userFeatures.primaryCity === event.venueCity
        ? 1
        : 0;
    const recencyBoost = calculateRecencyBoost(event.daysUntilEvent);
    const priceMatch = calculatePriceMatch(
      userFeatures.priceSensitivity,
      event.basePriceMinCzk,
      minPrice,
      maxPrice,
    );
    const explorationBonus = calculateExplorationBonus(event.daysSinceCreation);

    const components: ScoringComponents = {
      popularityScore,
      genreSimilarity,
      locationBonus,
      recencyBoost,
      priceMatch,
      explorationBonus,
    };

    const rawScore = calculateFinalScore(components, DEFAULT_SCORING_WEIGHTS);

    const passSet = new Set(userFeatures.activePassOrganizerIds);
    const hasPass = passSet.has(event.organizerId);

    const { key, params } = assignExplanation(components, {
      genreSimilarity,
      locationBonus,
      salesVelocity24h: event.salesVelocity24h,
      salesVelocityThreshold: velocityThreshold,
      explorationBonus,
      hasOrganizerPass: hasPass,
      organizerName: event.organizerName,
      city: event.venueCity,
      genre: event.category,
    });

    return {
      eventFeatures: event,
      scoringComponents: components,
      rawScore,
      finalScore: rawScore,
      explanationKey: key,
      explanationParams: params,
      rank: 0,
    };
  });

  // Sort by score descending and assign preliminary ranks
  scored.sort((a, b) => b.finalScore - a.finalScore);
  scored.forEach((c, i) => { c.rank = i + 1; });

  const businessContext: BusinessRulesContext = {
    purchasedEventIds: purchasedIds,
    activePassOrganizerIds: userFeatures.activePassOrganizerIds,
    diversityMaxPerCategory: 3,
    diversityTopN: 10,
  };

  const ranked: RankedCandidate[] = scored as RankedCandidate[];
  const filtered = applyBusinessRules(ranked, businessContext);

  // Take top 200 for storage
  const top200 = filtered.slice(0, 200);
  const expiresAt = new Date(Date.now() + EXPIRES_IN_MS);
  const now = new Date();

  return top200.map((c) => ({
    userId,
    eventId: c.eventFeatures.eventId,
    score: c.finalScore,
    rank: c.rank,
    explanationKey: c.explanationKey,
    explanationParams: c.explanationParams,
    modelVersion: MODEL_VERSION,
    expiresAt,
    createdAt: now,
  }));
}

async function upsertRecommendations(
  recommendations: UserRecommendation[],
  db: DbAdapter,
): Promise<void> {
  if (recommendations.length === 0) return;

  const values: unknown[] = [];
  const rows = recommendations.map((r, i) => {
    const base = i * 8;
    values.push(
      r.userId,
      r.eventId,
      r.score,
      r.rank,
      r.explanationKey,
      JSON.stringify(r.explanationParams),
      r.modelVersion,
      r.expiresAt.toISOString(),
    );
    return `($${base + 1}, $${base + 2}, $${base + 3}, $${base + 4}, $${base + 5}, $${base + 6}::jsonb, $${base + 7}, $${base + 8})`;
  });

  await db.execute(
    `INSERT INTO ai.user_recommendations
       (user_id, event_id, score, rank, explanation_key, explanation_params,
        model_version, expires_at)
     VALUES ${rows.join(", ")}
     ON CONFLICT (user_id, event_id)
     DO UPDATE SET
       score            = EXCLUDED.score,
       rank             = EXCLUDED.rank,
       explanation_key  = EXCLUDED.explanation_key,
       explanation_params = EXCLUDED.explanation_params,
       model_version    = EXCLUDED.model_version,
       expires_at       = EXCLUDED.expires_at`,
    values,
  );
}

async function fetchActiveUserBatch(
  db: DbAdapter,
  offset: number,
  limit: number,
): Promise<string[]> {
  const rows = await db.query<ActiveUserRow>(
    `SELECT DISTINCT u.user_id
     FROM (
       SELECT user_id FROM orders
         WHERE status = 'completed'
           AND created_at > NOW() - INTERVAL '${ACTIVE_USER_WINDOW_DAYS} days'
       UNION
       SELECT user_id FROM ai.browsing_events
         WHERE occurred_at > NOW() - INTERVAL '${ACTIVE_USER_WINDOW_DAYS} days'
           AND user_id IS NOT NULL
     ) u
     ORDER BY u.user_id
     LIMIT $1 OFFSET $2`,
    [limit, offset],
  );

  return rows.map((r) => r.user_id);
}

async function countActiveUsers(db: DbAdapter): Promise<number> {
  interface CountRow { count: string }

  const rows = await db.query<CountRow>(
    `SELECT COUNT(DISTINCT u.user_id) AS count
     FROM (
       SELECT user_id FROM orders
         WHERE status = 'completed'
           AND created_at > NOW() - INTERVAL '${ACTIVE_USER_WINDOW_DAYS} days'
       UNION
       SELECT user_id FROM ai.browsing_events
         WHERE occurred_at > NOW() - INTERVAL '${ACTIVE_USER_WINDOW_DAYS} days'
           AND user_id IS NOT NULL
     ) u`,
    [],
  );

  return parseInt(rows[0]?.count ?? "0", 10);
}

// ─── Main job function ────────────────────────────────────────────────────────

export async function runRecommendationBatchJob(
  deps: BatchJobDeps,
): Promise<BatchJobResult> {
  const startedAt = Date.now();
  let processed = 0;
  let failed = 0;
  let shutdownRequested = false;

  // Graceful shutdown handler
  const onShutdown = () => {
    console.log(
      "[recommendation-batch] Shutdown requested — will stop after current batch",
    );
    shutdownRequested = true;
  };
  process.on("SIGINT", onShutdown);
  process.on("SIGTERM", onShutdown);

  const totalUsers = await countActiveUsers(deps.db);
  console.log(
    `[recommendation-batch] Starting — ${totalUsers} active users to process`,
  );

  let offset = 0;

  while (!shutdownRequested) {
    const userIds = await fetchActiveUserBatch(deps.db, offset, BATCH_SIZE);
    if (userIds.length === 0) break;

    // Process users in parallel within the batch
    await Promise.allSettled(
      userIds.map(async (userId) => {
        try {
          const recommendations = await computeRecommendationsForUser(userId, deps);
          await upsertRecommendations(recommendations, deps.db);

          // Invalidate Redis cache so next API request gets fresh data
          await deps.redis.del(`reco:${userId}:v1`);

          processed++;

          if (processed % 100 === 0) {
            console.log(
              `[recommendation-batch] Progress: ${processed} / ${totalUsers} users processed`,
            );
          }
        } catch (err) {
          failed++;
          console.error(
            `[recommendation-batch] Failed to process userId=${userId}:`,
            err instanceof Error ? err.message : err,
          );
        }
      }),
    );

    offset += BATCH_SIZE;
  }

  // Remove shutdown listeners to avoid leaks in long-running processes
  process.off("SIGINT", onShutdown);
  process.off("SIGTERM", onShutdown);

  const durationMs = Date.now() - startedAt;
  console.log(
    `[recommendation-batch] Completed in ${durationMs}ms — ` +
      `processed=${processed}, failed=${failed}, total=${totalUsers}`,
  );

  return { totalUsers, processed, failed, durationMs };
}
