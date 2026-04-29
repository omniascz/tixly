/**
 * recommendation.service.ts — Orchestrates the full recommendation pipeline:
 *
 *   1. Load user features (Redis → PostgreSQL)
 *   2. Fetch candidate events
 *   3. Score candidates (popularity + content-based components)
 *   4. Apply business-rules post-filter
 *   5. Assign explanations
 *   6. Cache results in Redis (TTL 60 min)
 */

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
  getCandidateEvents,
  getUserFeatures,
  getUserPurchasedEventIds,
} from "./feature.service";
import {
  BusinessRulesContext,
  CachedRecommendations,
  DbAdapter,
  DEFAULT_SCORING_WEIGHTS,
  EventFeatures,
  ExplanationKey,
  RankedCandidate,
  RecommendationCandidate,
  RecommendationItem,
  RecommendationOptions,
  RecommendationResult,
  RedisAdapter,
  ScoringComponents,
  ScoringWeights,
  ServiceDeps,
  UserFeatures,
  UserRecommendation,
} from "../types/recommendation.types";

// ─── Constants ────────────────────────────────────────────────────────────────

const MODEL_VERSION = "popularity-v1";
const CACHE_TTL_SECONDS = 3600;
const cacheKey = (userId: string) => `tixly:reco:user:${userId}:v1`;

/** Batch candidates: 200 top events to score per user */
const CANDIDATE_LIMIT = 200;

/**
 * The 90th-percentile sales velocity used as the "trending" threshold.
 * In production this would be pre-computed by the batch job and stored in
 * Redis. Here we use a reasonable static default that the caller can override
 * via RecommendationOptions.
 */
const DEFAULT_VELOCITY_THRESHOLD = 50;

// ─── Scoring helpers ──────────────────────────────────────────────────────────

function deriveMinMaxPrice(events: EventFeatures[]): {
  min: number;
  max: number;
} {
  if (events.length === 0) return { min: 0, max: 1 };
  const prices = events.map((e) => e.basePriceMinCzk);
  return { min: Math.min(...prices), max: Math.max(...prices) };
}

function deriveMaxVelocity(events: EventFeatures[]): number {
  if (events.length === 0) return 1;
  return Math.max(...events.map((e) => e.salesVelocity24h), 1);
}

function scoreCandidate(
  event: EventFeatures,
  user: UserFeatures,
  minPrice: number,
  maxPrice: number,
  maxVelocity: number,
  weights: ScoringWeights,
): RecommendationCandidate {
  const popularityScore = calculatePopularityScore(
    event.sellThroughRate,
    event.salesVelocity24h,
    maxVelocity,
  );
  const genreSimilarity = calculateGenreSimilarity(user.genreVector, event.category);
  const locationBonus = user.primaryCity !== null && user.primaryCity === event.venueCity ? 1 : 0;
  const recencyBoost = calculateRecencyBoost(event.daysUntilEvent);
  const priceMatch = calculatePriceMatch(
    user.priceSensitivity,
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

  const rawScore = calculateFinalScore(components, weights);

  return { eventFeatures: event, scoringComponents: components, rawScore };
}

function rankCandidates(
  candidates: RecommendationCandidate[],
  user: UserFeatures,
  velocityThreshold: number,
): RankedCandidate[] {
  // Sort by raw score descending first
  const sorted = [...candidates].sort((a, b) => b.rawScore - a.rawScore);

  return sorted.map((c, idx) => {
    const passSet = new Set(user.activePassOrganizerIds);
    const hasPass = passSet.has(c.eventFeatures.organizerId);

    const { key, params } = assignExplanation(c.scoringComponents, {
      genreSimilarity: c.scoringComponents.genreSimilarity,
      locationBonus: c.scoringComponents.locationBonus,
      salesVelocity24h: c.eventFeatures.salesVelocity24h,
      salesVelocityThreshold: velocityThreshold,
      explorationBonus: c.scoringComponents.explorationBonus,
      hasOrganizerPass: hasPass,
      organizerName: c.eventFeatures.organizerName,
      city: c.eventFeatures.venueCity,
      genre: c.eventFeatures.category,
    });

    return {
      ...c,
      finalScore: c.rawScore,
      explanationKey: key,
      explanationParams: params,
      rank: idx + 1,
    };
  });
}

// ─── Cache operations ─────────────────────────────────────────────────────────

export async function getRecommendationsFromCache(
  userId: string,
  redis: RedisAdapter,
): Promise<CachedRecommendations | null> {
  const raw = await redis.get(cacheKey(userId));
  if (raw === null) return null;
  try {
    return JSON.parse(raw) as CachedRecommendations;
  } catch {
    return null;
  }
}

export async function cacheRecommendations(
  userId: string,
  recommendations: UserRecommendation[],
  redis: RedisAdapter,
): Promise<void> {
  const payload: CachedRecommendations = {
    recommendations,
    cachedAt: new Date().toISOString(),
  };
  await redis.set(cacheKey(userId), JSON.stringify(payload), CACHE_TTL_SECONDS);
}

export async function invalidateUserCache(
  userId: string,
  redis: RedisAdapter,
): Promise<void> {
  await redis.del(cacheKey(userId));
}

// ─── Persist to ai.user_recommendations ──────────────────────────────────────

async function persistRecommendations(
  userId: string,
  ranked: RankedCandidate[],
  db: DbAdapter,
): Promise<UserRecommendation[]> {
  const expiresAt = new Date(Date.now() + 2 * 60 * 60 * 1000); // +2 hours
  const now = new Date();

  const recommendations: UserRecommendation[] = ranked.map((c) => ({
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

  if (recommendations.length === 0) return [];

  // Build VALUES clause for batch upsert
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
       (user_id, event_id, score, rank, explanation_key, explanation_params, model_version, expires_at)
     VALUES ${rows.join(", ")}
     ON CONFLICT (user_id, event_id)
     DO UPDATE SET
       score = EXCLUDED.score,
       rank = EXCLUDED.rank,
       explanation_key = EXCLUDED.explanation_key,
       explanation_params = EXCLUDED.explanation_params,
       model_version = EXCLUDED.model_version,
       expires_at = EXCLUDED.expires_at`,
    values,
  );

  return recommendations;
}

// ─── Main orchestrator ────────────────────────────────────────────────────────

export interface RecommendationServiceOptions extends RecommendationOptions {
  weights?: ScoringWeights;
  velocityThreshold?: number;
  candidateLimit?: number;
  skipCache?: boolean;
}

export async function generateRecommendations(
  userId: string,
  options: RecommendationServiceOptions,
  deps: ServiceDeps,
): Promise<RecommendationResult> {
  const { db, redis } = deps;
  const weights = options.weights ?? DEFAULT_SCORING_WEIGHTS;
  const velocityThreshold = options.velocityThreshold ?? DEFAULT_VELOCITY_THRESHOLD;
  const candidateLimit = options.candidateLimit ?? CANDIDATE_LIMIT;

  // ── Step 1: Try cache first ──────────────────────────────────────────────
  if (!options.skipCache) {
    const cached = await getRecommendationsFromCache(userId, redis);
    if (cached !== null) {
      const items = applyFiltersAndContext(
        cached.recommendations,
        options,
      );
      return {
        recommendations: items,
        modelVersion: MODEL_VERSION,
        personalized: true,
        computedAt: cached.cachedAt,
      };
    }
  }

  // ── Step 2: Check ai.user_recommendations (pre-computed by batch job) ────
  const precomputed = await loadPrecomputedRecommendations(userId, db);
  if (precomputed.length > 0) {
    const items = applyFiltersAndContext(precomputed, options);
    // Populate Redis cache for next request
    cacheRecommendations(userId, precomputed, redis).catch(() => {});
    return {
      recommendations: items,
      modelVersion: MODEL_VERSION,
      personalized: true,
      computedAt: new Date().toISOString(),
    };
  }

  // ── Step 3: Cold-path — compute on the fly ───────────────────────────────
  const userFeatures = await getUserFeatures(userId, db, redis);

  if (userFeatures === null) {
    // Guest or brand new user — return popularity-only fallback
    return await getFallbackRecommendations(db, options);
  }

  const [candidates, purchasedIds] = await Promise.all([
    getCandidateEvents(userFeatures, db, candidateLimit),
    getUserPurchasedEventIds(userId, db),
  ]);

  const { min: minPrice, max: maxPrice } = deriveMinMaxPrice(candidates);
  const maxVelocity = deriveMaxVelocity(candidates);

  const scored = candidates.map((event) =>
    scoreCandidate(event, userFeatures, minPrice, maxPrice, maxVelocity, weights),
  );

  const ranked = rankCandidates(scored, userFeatures, velocityThreshold);

  const businessContext: BusinessRulesContext = {
    purchasedEventIds: purchasedIds,
    activePassOrganizerIds: userFeatures.activePassOrganizerIds,
    diversityMaxPerCategory: 3,
    diversityTopN: 10,
  };

  const filtered = applyBusinessRules(ranked, businessContext);

  // Persist top 200 to ai.user_recommendations and cache top 50
  const top200 = filtered.slice(0, 200);
  const [persisted] = await Promise.all([
    persistRecommendations(userId, top200, db),
    Promise.resolve(),
  ]);

  cacheRecommendations(userId, persisted, redis).catch(() => {});

  const items = applyFiltersAndContext(persisted, options);

  return {
    recommendations: items,
    modelVersion: MODEL_VERSION,
    personalized: true,
    computedAt: new Date().toISOString(),
  };
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

async function loadPrecomputedRecommendations(
  userId: string,
  db: DbAdapter,
): Promise<UserRecommendation[]> {
  interface Row {
    user_id: string;
    event_id: string;
    score: number;
    rank: number;
    explanation_key: ExplanationKey;
    explanation_params: Record<string, string>;
    model_version: string;
    expires_at: string;
    created_at: string;
  }

  const rows = await db.query<Row>(
    `SELECT user_id, event_id, score, rank, explanation_key,
            explanation_params, model_version, expires_at, created_at
     FROM ai.user_recommendations
     WHERE user_id = $1
       AND expires_at > NOW()
     ORDER BY rank ASC
     LIMIT 200`,
    [userId],
  );

  return rows.map((r) => ({
    userId: r.user_id,
    eventId: r.event_id,
    score: r.score,
    rank: r.rank,
    explanationKey: r.explanation_key,
    explanationParams: r.explanation_params,
    modelVersion: r.model_version,
    expiresAt: new Date(r.expires_at),
    createdAt: new Date(r.created_at),
  }));
}

/**
 * Apply optional category/city filters and real-time context adjustments,
 * then return the final RecommendationItem list.
 */
function applyFiltersAndContext(
  recommendations: UserRecommendation[],
  options: RecommendationOptions,
): RecommendationItem[] {
  let filtered = recommendations;

  if (options.categoryFilter) {
    // explanationParams may carry genre; we filter by explanationKey heuristic.
    // In a real setup we'd join with event data — here we use explanation params.
    filtered = filtered.filter(
      (r) =>
        r.explanationParams["genre"] === options.categoryFilter ||
        r.explanationKey === ExplanationKey.GenreMatch,
    );
  }

  if (options.cityFilter) {
    filtered = filtered.filter(
      (r) => r.explanationParams["city"] === options.cityFilter,
    );
  }

  // Real-time context: apply a small evening boost (18:00–23:00) for weekend events
  const hour = options.hourOfDay ?? new Date().getHours();
  const isEvening = hour >= 18 && hour < 23;

  const contextAdjusted = filtered.map((r) => {
    let score = r.score;
    if (isEvening && options.deviceType === "mobile") {
      // Mobile users in the evening get a slight recency tilt (last-minute discovery)
      score = Math.min(1, score * 1.05);
    }
    return { ...r, score };
  });

  // Re-sort after context adjustment and apply requested limit
  contextAdjusted.sort((a, b) => b.score - a.score);

  return contextAdjusted.slice(0, options.limit).map((r, idx) => ({
    eventId: r.eventId,
    score: r.score,
    rank: idx + 1,
    explanation: buildExplanationText(r.explanationKey, r.explanationParams),
    explanationKey: r.explanationKey,
    explanationParams: r.explanationParams,
  }));
}

function buildExplanationText(
  key: ExplanationKey,
  params: Record<string, string>,
): string {
  switch (key) {
    case ExplanationKey.GenreMatch:
      return `Because you like ${params["genre"] ?? "this genre"}`;
    case ExplanationKey.PopularInCity:
      return `Popular in ${params["city"] ?? "your city"}`;
    case ExplanationKey.LocationMatch:
      return `Happening in ${params["city"] ?? "your city"}`;
    case ExplanationKey.Trending:
      return "Trending right now";
    case ExplanationKey.NewEvent:
      return "Just announced";
    case ExplanationKey.OrganizerPass:
      return `From ${params["organizerName"] ?? "your pass organizer"}`;
    case ExplanationKey.HiddenGem:
      return "Hidden gem you might love";
    case ExplanationKey.SimilarToEvent:
      return "Similar to an event you viewed";
    default:
      return "Recommended for you";
  }
}

async function getFallbackRecommendations(
  db: DbAdapter,
  options: RecommendationOptions,
): Promise<RecommendationResult> {
  interface Row {
    event_id: string;
    sales_velocity_24h: number;
    venue_city: string;
  }

  const limit = options.limit;

  const rows = await db.query<Row>(
    `SELECT event_id, sales_velocity_24h, venue_city
     FROM ai.event_features
     WHERE days_until_event > 0
       AND sell_through_rate < 1.0
     ORDER BY sales_velocity_24h DESC
     LIMIT $1`,
    [limit],
  );

  const items: RecommendationItem[] = rows.map((r, idx) => ({
    eventId: r.event_id,
    score: 0,
    rank: idx + 1,
    explanation: `Popular in ${r.venue_city}`,
    explanationKey: ExplanationKey.PopularInCity,
    explanationParams: { city: r.venue_city },
  }));

  return {
    recommendations: items,
    modelVersion: MODEL_VERSION,
    personalized: false,
    computedAt: new Date().toISOString(),
  };
}
