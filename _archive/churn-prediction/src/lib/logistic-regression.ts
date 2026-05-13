/**
 * logistic-regression.ts — Pure, stateless logistic regression model for
 * churn probability scoring.
 *
 * The coefficients are hard-coded constants representing a pre-trained model.
 * Feature engineering (extraction + normalisation) is handled separately in
 * feature-extractor.ts. This module only performs inference.
 *
 * Phase 2 migration path: replace MODEL_COEFFICIENTS with ONNX inference and
 * keep the same public API (predictChurnProbability, getTopFeatures).
 */

import type { ChurnFeatures, RawChurnFeatures, TopFeature } from "../types/churn.types";

// ─── Model coefficients ───────────────────────────────────────────────────────

/**
 * Pre-trained logistic regression coefficients.
 *
 * Baseline: z = b0 alone → sigmoid(1.2) ≈ 0.77, which reflects the
 * conservative prior that a holder without any data is likely to churn.
 *
 * All feature inputs are expected to be normalised to [0,1] before scoring.
 */
export const MODEL_COEFFICIENTS = {
  /** Intercept — baseline churn log-odds. */
  b0: 1.2,
  /** High usage strongly reduces churn probability. */
  b1_usage_rate: -3.5,
  /** Each additional day-unit since last visit raises churn risk. */
  b2_days_since_last_usage: 0.04,
  /** Widening inter-visit gaps are a strong churn signal. */
  b3_usage_gap_trend: 3.4,
  /** High cohort renewal rate reduces individual churn probability. */
  b4_cohort_renewal_rate: -2.8,
  /** Longer subscriber tenure indicates loyalty. */
  b5_months_as_subscriber: -0.15,
} as const;

// ─── Normalisation bounds ─────────────────────────────────────────────────────

/**
 * Min/max bounds used by normalizeFeatures().
 * Values outside these bounds are clamped to [0,1].
 *
 * usage_rate and cohort_renewal_rate are already [0,1] — bounds are
 * included here for completeness and documentation.
 */
export const NORMALISATION_BOUNDS = {
  usage_rate: { min: 0, max: 1 },
  days_since_last_usage: { min: 0, max: 180 },
  usage_gap_trend: { min: -10, max: 10 },
  cohort_renewal_rate: { min: 0, max: 1 },
  months_as_subscriber: { min: 0, max: 60 },
} as const;

// ─── Core math ────────────────────────────────────────────────────────────────

/**
 * Logistic sigmoid function.
 *
 * Maps any real number to the open interval (0, 1).
 * Numerically stable for extreme values of z.
 */
export function sigmoid(z: number): number {
  const cz = Math.max(-709, Math.min(709, z));
  return 1 / (1 + Math.exp(-cz));
}

// ─── Feature normalisation ────────────────────────────────────────────────────

/**
 * Normalises raw feature values into [0,1] using the documented bounds.
 *
 * Any value below min is clamped to 0; any value above max is clamped to 1.
 * usage_rate and cohort_renewal_rate are validated and clamped but not
 * linearly transformed (they are already on [0,1]).
 */
export function normalizeFeatures(raw: RawChurnFeatures): ChurnFeatures {
  const clamp = (value: number, min: number, max: number): number => {
    if (max === min) return 0;
    return Math.min(1, Math.max(0, (value - min) / (max - min)));
  };

  return {
    usage_rate: clamp(
      raw.usage_rate,
      NORMALISATION_BOUNDS.usage_rate.min,
      NORMALISATION_BOUNDS.usage_rate.max,
    ),
    days_since_last_usage: clamp(
      raw.days_since_last_usage,
      NORMALISATION_BOUNDS.days_since_last_usage.min,
      NORMALISATION_BOUNDS.days_since_last_usage.max,
    ),
    usage_gap_trend: clamp(
      raw.usage_gap_trend,
      NORMALISATION_BOUNDS.usage_gap_trend.min,
      NORMALISATION_BOUNDS.usage_gap_trend.max,
    ),
    cohort_renewal_rate: clamp(
      raw.cohort_renewal_rate,
      NORMALISATION_BOUNDS.cohort_renewal_rate.min,
      NORMALISATION_BOUNDS.cohort_renewal_rate.max,
    ),
    months_as_subscriber: clamp(
      raw.months_as_subscriber,
      NORMALISATION_BOUNDS.months_as_subscriber.min,
      NORMALISATION_BOUNDS.months_as_subscriber.max,
    ),
  };
}

// ─── Scoring ──────────────────────────────────────────────────────────────────

/**
 * Computes the raw log-odds score (z) for the given normalised features.
 *
 * z = b0
 *   + b1 × usage_rate
 *   + b2 × days_since_last_usage
 *   + b3 × usage_gap_trend
 *   + b4 × cohort_renewal_rate
 *   + b5 × months_as_subscriber
 */
export function computeLogisticScore(features: ChurnFeatures): number {
  const c = MODEL_COEFFICIENTS;
  return (
    c.b0 +
    c.b1_usage_rate * features.usage_rate +
    c.b2_days_since_last_usage * features.days_since_last_usage +
    c.b3_usage_gap_trend * features.usage_gap_trend +
    c.b4_cohort_renewal_rate * features.cohort_renewal_rate +
    c.b5_months_as_subscriber * features.months_as_subscriber
  );
}

/**
 * Returns the churn probability for the given normalised features.
 *
 * Output is clamped to (0.001, 0.999) to avoid log(0) in downstream
 * log-loss calculations and to signal that no prediction is ever certain.
 */
export function predictChurnProbability(features: ChurnFeatures): number {
  const z = computeLogisticScore(features);
  const raw = sigmoid(z);
  return Math.min(0.999, Math.max(0.001, raw));
}

// ─── Feature importance ───────────────────────────────────────────────────────

/**
 * Returns the top 3 features ranked by their absolute contribution to the
 * final log-odds score.
 *
 * Contribution of feature i = |coefficient_i × normalised_value_i|
 *
 * Direction is determined by the sign of (coefficient × value):
 *   positive contribution → feature increases churn probability
 *   negative contribution → feature decreases churn probability
 *
 * Impact levels:
 *   high   — abs(contribution) in top third
 *   medium — abs(contribution) in middle third
 *   low    — abs(contribution) in bottom third
 */
export function getTopFeatures(features: ChurnFeatures): TopFeature[] {
  const c = MODEL_COEFFICIENTS;

  // Signed contributions (coefficient × normalised_value)
  const contributions: Array<{
    name: keyof ChurnFeatures;
    contribution: number;
  }> = [
    {
      name: "usage_rate",
      contribution: c.b1_usage_rate * features.usage_rate,
    },
    {
      name: "days_since_last_usage",
      contribution: c.b2_days_since_last_usage * features.days_since_last_usage,
    },
    {
      name: "usage_gap_trend",
      contribution: c.b3_usage_gap_trend * features.usage_gap_trend,
    },
    {
      name: "cohort_renewal_rate",
      contribution: c.b4_cohort_renewal_rate * features.cohort_renewal_rate,
    },
    {
      name: "months_as_subscriber",
      contribution: c.b5_months_as_subscriber * features.months_as_subscriber,
    },
  ];

  // Sort by absolute contribution descending
  contributions.sort(
    (a, b) => Math.abs(b.contribution) - Math.abs(a.contribution),
  );

  const top3 = contributions.slice(0, 3);

  // Determine impact thresholds from the top-3 absolute values
  const absValues = top3.map((c) => Math.abs(c.contribution));
  const maxAbs = absValues[0] ?? 0;
  const midThreshold = maxAbs * 0.6;
  const lowThreshold = maxAbs * 0.3;

  return top3.map((item) => {
    const abs = Math.abs(item.contribution);
    let impact: TopFeature["impact"];
    if (abs >= midThreshold) {
      impact = "high";
    } else if (abs >= lowThreshold) {
      impact = "medium";
    } else {
      impact = "low";
    }

    return {
      name: item.name,
      value: features[item.name],
      impact,
      direction:
        item.contribution > 0 ? "increases_churn" : "decreases_churn",
    };
  });
}
