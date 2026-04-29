/**
 * scoring.ts — Pure scoring functions for the recommendation engine.
 *
 * All functions are stateless and side-effect free, making them easy to unit
 * test and safe to run inside the batch job as well as the real-time API.
 */

import {
  ExplanationContext,
  ExplanationKey,
  ScoringComponents,
  ScoringWeights,
} from "../types/recommendation.types";

// ─── Genre similarity ─────────────────────────────────────────────────────────

/**
 * Cosine similarity between the user's genre weight vector and a one-hot
 * vector for the event's category.
 *
 * user_vector  = { rock: 0.7, pop: 0.3 }
 * event_vector = { rock: 1.0 }   (one-hot for category "rock")
 *
 * cosine = (u · e) / (||u|| × ||e||)
 *
 * Because the event vector is one-hot with magnitude 1, this simplifies to:
 *   cosine = userVector[eventCategory] / ||userVector||
 */
export function calculateGenreSimilarity(
  userVector: Record<string, number>,
  eventCategory: string,
): number {
  const keys = Object.keys(userVector);
  if (keys.length === 0) return 0;

  // dot product with the one-hot event vector
  const dotProduct = userVector[eventCategory] ?? 0;
  if (dotProduct === 0) return 0;

  // magnitude of user vector
  const magnitude = Math.sqrt(
    keys.reduce((sum, k) => sum + userVector[k] * userVector[k], 0),
  );

  if (magnitude === 0) return 0;

  return Math.min(1, Math.max(0, dotProduct / magnitude));
}

// ─── Recency boost ────────────────────────────────────────────────────────────

/**
 * Boost for events happening soon.
 *
 * Formula: 1 / (1 + ln(daysUntilEvent + 1))
 *
 * Examples:
 *   0 days  → 1.0      (happening today)
 *   6 days  → ~0.59
 *   30 days → ~0.29
 *   365 days → ~0.17
 */
export function calculateRecencyBoost(daysUntilEvent: number): number {
  if (daysUntilEvent < 0) return 0;
  return 1 / (1 + 1.5 * Math.log(daysUntilEvent + 1));
}

// ─── Price match ──────────────────────────────────────────────────────────────

/**
 * How well the event price matches the user's price sensitivity.
 *
 * normalized_price = clamp((price - min) / (max - min), 0, 1)
 * score = 1 - |normalized_price - user_sensitivity|
 *
 * Returns 1.0 when the event price aligns perfectly with user sensitivity,
 * 0.0 when they are at opposite ends of the scale.
 *
 * If min === max (all events same price), normalized_price is 0.5.
 */
export function calculatePriceMatch(
  userSensitivity: number,
  eventPrice: number,
  minPrice: number,
  maxPrice: number,
): number {
  let normalizedPrice: number;

  if (maxPrice === minPrice) {
    normalizedPrice = 0.5;
  } else {
    normalizedPrice = (eventPrice - minPrice) / (maxPrice - minPrice);
  }

  // clamp to [0, 1]
  normalizedPrice = Math.min(1, Math.max(0, normalizedPrice));

  return Math.min(1, Math.max(0, 1 - Math.abs(normalizedPrice - userSensitivity)));
}

// ─── Exploration bonus ────────────────────────────────────────────────────────

/**
 * Boost for newly created events (< 7 days since creation).
 *
 * Decreases linearly from 0.15 (day 0) to 0.0 (day 7).
 * Returns 0 for events older than 7 days.
 */
export function calculateExplorationBonus(daysSinceCreation: number): number {
  if (daysSinceCreation < 0) return 0.15; // guard against bad data
  if (daysSinceCreation >= 7) return 0;
  return 0.15 * (1 - daysSinceCreation / 7);
}

// ─── Final score ──────────────────────────────────────────────────────────────

/**
 * Weighted sum of all scoring components.
 *
 * score_final = α × popularity
 *             + β × genre_similarity
 *             + γ × location_bonus
 *             + δ × recency_boost
 *             + ε × price_match
 *             + ζ × exploration_bonus
 *
 * Result is clamped to [0, 1] to handle edge cases where individual
 * components exceed their expected range.
 */
export function calculateFinalScore(
  components: ScoringComponents,
  weights: ScoringWeights,
): number {
  const raw =
    weights.alpha * components.popularityScore +
    weights.beta * components.genreSimilarity +
    weights.gamma * components.locationBonus +
    weights.delta * components.recencyBoost +
    weights.epsilon * components.priceMatch +
    weights.zeta * components.explorationBonus;

  return Math.min(1, Math.max(0, raw));
}

// ─── Explanation assignment ───────────────────────────────────────────────────

/**
 * Assigns an explanation key and params based on which scoring components
 * contributed most to the final score.
 *
 * Priority order:
 *   1. organizer_pass  — user holds a season pass from this organizer
 *   2. genre_match     — strong genre affinity (similarity > 0.7)
 *   3. new_event       — event created < 7 days ago
 *   4. trending        — sales velocity in top 10% (above threshold)
 *   5. location_match  — event in user's city (locationBonus = 1)
 *   6. popular_in_city — fallback when city matches but genre doesn't
 *   7. popular_in_city — final fallback
 */
export function assignExplanation(
  components: ScoringComponents,
  context: ExplanationContext,
): { key: ExplanationKey; params: Record<string, string> } {
  if (context.hasOrganizerPass) {
    return {
      key: ExplanationKey.OrganizerPass,
      params: { organizerName: context.organizerName },
    };
  }

  if (context.genreSimilarity > 0.7) {
    return {
      key: ExplanationKey.GenreMatch,
      params: { genre: context.genre },
    };
  }

  if (context.explorationBonus > 0) {
    return {
      key: ExplanationKey.NewEvent,
      params: {},
    };
  }

  if (context.salesVelocity24h >= context.salesVelocityThreshold) {
    return {
      key: ExplanationKey.Trending,
      params: {},
    };
  }

  if (context.locationBonus === 1) {
    return {
      key: ExplanationKey.LocationMatch,
      params: { city: context.city },
    };
  }

  return {
    key: ExplanationKey.PopularInCity,
    params: { city: context.city },
  };
}

// ─── Popularity score helper ──────────────────────────────────────────────────

/**
 * Derives a [0,1] popularity score from sell-through rate and sales velocity.
 *
 * Combines two signals:
 *   - sell_through_rate: fraction of capacity already sold
 *   - sales_velocity_24h: normalised to [0,1] using the provided max velocity
 *
 * Equal weight between the two signals.
 */
export function calculatePopularityScore(
  sellThroughRate: number,
  salesVelocity24h: number,
  maxSalesVelocity: number,
): number {
  const velocityNorm =
    maxSalesVelocity > 0
      ? Math.min(1, salesVelocity24h / maxSalesVelocity)
      : 0;

  return Math.min(1, Math.max(0, (sellThroughRate + velocityNorm) / 2));
}
