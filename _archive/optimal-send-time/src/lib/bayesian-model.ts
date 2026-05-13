/**
 * Bayesian Beta-Binomial model for Optimal Send Time
 *
 * Model summary
 * ─────────────
 * For each hour H ∈ {0…23} we maintain a Beta distribution:
 *
 *   θ_H ~ Beta(α_H, β_H)
 *
 * where θ_H is the probability that a user opens an e-mail sent at hour H.
 *
 * Prior:   α₀_H = HOUR_PRIORS[H],  β₀_H = PRIOR_STRENGTH − α₀_H
 * Update:  open/click in H  → α_H += 1
 *          delivered, no open → β_H += 1
 * Estimate: E[θ_H | data] = α_H / (α_H + β_H)   (posterior mean)
 *
 * The identical structure is used for day-of-week with 7 bins.
 *
 * All functions are pure (no side-effects, no I/O).
 */

import type { BetaDistribution, HourDistribution, DayDistribution } from '../types/send-time.types';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Equivalent number of historic e-mails the prior represents */
export const PRIOR_STRENGTH = 10;

/** Below this threshold the model is considered a cohort (cold-start) fallback */
export const COLD_START_THRESHOLD = 5;

/**
 * Hour priors (α₀_H).
 * Values reflect average Czech open-rate patterns ×  PRIOR_STRENGTH.
 * β₀_H = PRIOR_STRENGTH − α₀_H  is computed automatically.
 *
 * Peaks:
 *  • Morning commute  07–09h  (highest)
 *  • Lunch break      12–13h  (second peak)
 *  • Evening          18–20h  (third peak)
 */
export const HOUR_PRIORS: Record<number, number> = {
   0: 0.5,  1: 0.3,  2: 0.2,  3: 0.2,  4: 0.3,  5: 0.5,
   6: 1.0,  7: 2.5,  8: 3.0,  9: 2.8, 10: 2.2, 11: 2.0,
  12: 2.5, 13: 2.3, 14: 1.8, 15: 1.6, 16: 1.7, 17: 2.0,
  18: 2.4, 19: 2.6, 20: 2.2, 21: 1.8, 22: 1.2, 23: 0.7,
};

/**
 * Day-of-week priors (α₀_D).
 * 0 = Monday … 6 = Sunday.
 * Czechs open most on Tuesday / Wednesday; least on Sunday.
 */
export const DAY_PRIORS: Record<number, number> = {
  0: 2.8,   // Monday
  1: 3.2,   // Tuesday
  2: 3.4,   // Wednesday
  3: 3.0,   // Thursday
  4: 2.6,   // Friday
  5: 2.0,   // Saturday
  6: 1.8,   // Sunday
};

// ---------------------------------------------------------------------------
// Initialisation helpers
// ---------------------------------------------------------------------------

/**
 * Compute posteriorMean from α and β.
 * Inline helper; not exported to keep the public API minimal.
 */
function posteriorMean(alpha: number, beta: number): number {
  return alpha / (alpha + beta);
}

/**
 * Build the initial Beta distribution for a single bin from a prior α value.
 *
 * α₀ is given; β₀ = PRIOR_STRENGTH − α₀.
 * The sampleSize starts at 0 (no real observations yet).
 */
function initBeta(alpha0: number): BetaDistribution {
  const beta0 = PRIOR_STRENGTH - alpha0;
  return {
    alpha: alpha0,
    beta: beta0,
    posteriorMean: posteriorMean(alpha0, beta0),
    sampleSize: 0,
  };
}

/**
 * Initialise 24 Beta distributions (one per hour) from HOUR_PRIORS.
 */
export function initHourPosteriors(): Record<number, BetaDistribution> {
  const result: Record<number, BetaDistribution> = {};
  for (let h = 0; h < 24; h++) {
    result[h] = initBeta(HOUR_PRIORS[h]);
  }
  return result;
}

/**
 * Initialise 7 Beta distributions (one per day-of-week) from DAY_PRIORS.
 */
export function initDayPosteriors(): Record<number, BetaDistribution> {
  const result: Record<number, BetaDistribution> = {};
  for (let d = 0; d < 7; d++) {
    result[d] = initBeta(DAY_PRIORS[d]);
  }
  return result;
}

// ---------------------------------------------------------------------------
// Bayesian update
// ---------------------------------------------------------------------------

/**
 * Perform one Bayesian update on a Beta distribution (immutable).
 *
 *   Likelihood:  Bernoulli(θ)
 *   Conjugate:   Beta(α, β)
 *
 *   Posterior:   Beta(α + 1, β)   if wasOpened = true   (success)
 *                Beta(α, β + 1)   if wasOpened = false  (failure)
 *
 * Returns a new BetaDistribution; the original is not modified.
 */
export function updatePosterior(
  dist: BetaDistribution,
  wasOpened: boolean
): BetaDistribution {
  const newAlpha = wasOpened ? dist.alpha + 1 : dist.alpha;
  const newBeta  = wasOpened ? dist.beta      : dist.beta + 1;
  return {
    alpha: newAlpha,
    beta: newBeta,
    posteriorMean: posteriorMean(newAlpha, newBeta),
    sampleSize: dist.sampleSize + 1,
  };
}

/**
 * Apply a batch of engagement events to the hour and day posteriors.
 *
 * For each event:
 *   - Update posteriors[event.hourOfDay]   (hour model)
 *   - Update dayPosteriors[event.dayOfWeek] (day-of-week model)
 *
 * Returns new objects; originals are not mutated.
 */
export function applyEngagementEvents(
  hourPosteriors: Record<number, BetaDistribution>,
  dayPosteriors: Record<number, BetaDistribution>,
  events: Array<{ hourOfDay: number; dayOfWeek: number; wasOpened: boolean }>
): {
  hourPosteriors: Record<number, BetaDistribution>;
  dayPosteriors: Record<number, BetaDistribution>;
} {
  if (events.length === 0) {
    return { hourPosteriors, dayPosteriors };
  }

  // Shallow-copy so we never mutate the inputs
  const newHour: Record<number, BetaDistribution> = { ...hourPosteriors };
  const newDay:  Record<number, BetaDistribution> = { ...dayPosteriors  };

  for (const event of events) {
    const h = event.hourOfDay;
    const d = event.dayOfWeek;

    if (h < 0 || h > 23 || newHour[h] === undefined) continue;
    if (d < 0 || d > 6  || newDay[d]  === undefined) continue;

    newHour[h] = updatePosterior(newHour[h], event.wasOpened);
    newDay[d]  = updatePosterior(newDay[d],  event.wasOpened);
  }

  return { hourPosteriors: newHour, dayPosteriors: newDay };
}

// ---------------------------------------------------------------------------
// Decision functions
// ---------------------------------------------------------------------------

/**
 * Select the hour with the highest posterior mean.
 * Tie-break: prefer the earlier hour (e.g. 7 beats 19 if equal).
 */
export function getBestHour(posteriors: Record<number, BetaDistribution>): number {
  let bestHour = 0;
  let bestMean = -Infinity;

  for (let h = 0; h < 24; h++) {
    const mean = posteriors[h]?.posteriorMean ?? 0;
    if (mean > bestMean) {
      bestMean = mean;
      bestHour = h;
    }
    // Tie-break handled implicitly: we iterate low → high and only update on
    // strict improvement, so the earlier hour is always retained on a tie.
  }

  return bestHour;
}

/**
 * Select the day-of-week with the highest posterior mean.
 * Tie-break: prefer Monday (lower index).
 */
export function getBestDay(posteriors: Record<number, BetaDistribution>): number {
  let bestDay  = 0;
  let bestMean = -Infinity;

  for (let d = 0; d < 7; d++) {
    const mean = posteriors[d]?.posteriorMean ?? 0;
    if (mean > bestMean) {
      bestMean = mean;
      bestDay  = d;
    }
  }

  return bestDay;
}

// ---------------------------------------------------------------------------
// Distribution normalisation
// ---------------------------------------------------------------------------

/**
 * Convert posterior means into a normalised probability distribution.
 *
 * Given {h: posterior_mean_h}, compute:
 *   p_h = posterior_mean_h / Σ posterior_mean_k
 *
 * The result is a proper probability distribution (all values ≥ 0, sum = 1).
 */
export function normalizeToDistribution(
  posteriors: Record<number, BetaDistribution>
): Record<number, number> {
  const keys = Object.keys(posteriors).map(Number);
  const total = keys.reduce((acc, k) => acc + (posteriors[k]?.posteriorMean ?? 0), 0);

  const result: Record<number, number> = {};

  if (total === 0) {
    // Degenerate case — uniform distribution
    const uniform = 1 / keys.length;
    for (const k of keys) result[k] = uniform;
    return result;
  }

  for (const k of keys) {
    result[k] = (posteriors[k]?.posteriorMean ?? 0) / total;
  }

  return result;
}

// ---------------------------------------------------------------------------
// Confidence & cold-start
// ---------------------------------------------------------------------------

/**
 * Confidence score based on the number of real observations.
 *
 *   confidence = 1 − 1 / (1 + n / 20)
 *
 * This is a smooth sigmoid-like function:
 *   n =  0  → 0.00
 *   n =  5  → 0.20
 *   n = 20  → 0.50
 *   n = 100 → 0.83
 *
 * Clamped to [0, 1].
 */
export function calculateConfidence(totalDataPoints: number): number {
  const raw = 1 - 1 / (1 + totalDataPoints / 20);
  return Math.min(1, Math.max(0, raw));
}

/**
 * Returns true when there are fewer real observations than the cold-start
 * threshold — meaning the model is still dominated by the cohort prior.
 */
export function isCohortFallback(totalDataPoints: number): boolean {
  return totalDataPoints < COLD_START_THRESHOLD;
}
