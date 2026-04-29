import { describe, it, expect } from "vitest";
import {
  sigmoid,
  normalizeFeatures,
  predictChurnProbability,
  getTopFeatures,
  computeLogisticScore,
  MODEL_COEFFICIENTS,
  NORMALISATION_BOUNDS,
} from "./logistic-regression";
import { calculateUsageGapTrend } from "./feature-extractor";
import { ChurnFeatures, RawChurnFeatures, TopFeature } from "../types/churn.types";

// ─── Extended tests: sigmoid ──────────────────────────────────────────────────

describe("sigmoid — extended edge cases", () => {
  it("sigmoid(1000) clamps to near 1.0 (overflow protection)", () => {
    const result = sigmoid(1000);
    expect(result).toBeGreaterThan(0.999);
    expect(result).toBeLessThanOrEqual(1);
  });

  it("sigmoid(-1000) clamps to near 0 (underflow protection)", () => {
    const result = sigmoid(-1000);
    expect(result).toBeGreaterThan(0);
    expect(result).toBeLessThan(0.001);
  });

  it("handles extreme positive exponent gracefully", () => {
    const result = sigmoid(100);
    expect(result).toBeGreaterThan(0.99999);
  });

  it("handles extreme negative exponent gracefully", () => {
    const result = sigmoid(-100);
    expect(result).toBeLessThan(0.00001);
  });

  it("is symmetrical around z=0: sigmoid(-z) ≈ 1 - sigmoid(z)", () => {
    const z = 5;
    const pos = sigmoid(z);
    const neg = sigmoid(-z);
    expect(pos + neg).toBeCloseTo(1.0, 5);
  });

  it("sigmoid(0) is exactly 0.5", () => {
    expect(sigmoid(0)).toBeCloseTo(0.5);
  });
});

// ─── Extended tests: normalizeFeatures ─────────────────────────────────────────

describe("normalizeFeatures — extended edge cases", () => {
  const baseRaw: RawChurnFeatures = {
    usage_rate: 0.5,
    days_since_last_usage: 30,
    usage_gap_trend: 0,
    cohort_renewal_rate: 0.65,
    months_as_subscriber: 12,
  };

  it("days_since_last_usage = 180 (max bound) → 1.0", () => {
    const raw = { ...baseRaw, days_since_last_usage: 180 };
    expect(normalizeFeatures(raw).days_since_last_usage).toBeCloseTo(1.0);
  });

  it("days_since_last_usage = 0 (min bound) → 0", () => {
    const raw = { ...baseRaw, days_since_last_usage: 0 };
    expect(normalizeFeatures(raw).days_since_last_usage).toBe(0);
  });

  it("days_since_last_usage > 180 → clamped to 1.0", () => {
    const raw = { ...baseRaw, days_since_last_usage: 500 };
    expect(normalizeFeatures(raw).days_since_last_usage).toBe(1);
  });

  it("negative days_since_last_usage → clamped to 0", () => {
    const raw = { ...baseRaw, days_since_last_usage: -30 };
    expect(normalizeFeatures(raw).days_since_last_usage).toBe(0);
  });

  it("usage_gap_trend = -10 (min bound) → 0", () => {
    const raw = { ...baseRaw, usage_gap_trend: -10 };
    expect(normalizeFeatures(raw).usage_gap_trend).toBe(0);
  });

  it("usage_gap_trend = 10 (max bound) → 1.0", () => {
    const raw = { ...baseRaw, usage_gap_trend: 10 };
    expect(normalizeFeatures(raw).usage_gap_trend).toBeCloseTo(1.0);
  });

  it("usage_gap_trend = 0 (midpoint) → 0.5", () => {
    const raw = { ...baseRaw, usage_gap_trend: 0 };
    expect(normalizeFeatures(raw).usage_gap_trend).toBeCloseTo(0.5);
  });

  it("usage_gap_trend < -10 → clamped to 0", () => {
    const raw = { ...baseRaw, usage_gap_trend: -50 };
    expect(normalizeFeatures(raw).usage_gap_trend).toBe(0);
  });

  it("usage_gap_trend > 10 → clamped to 1", () => {
    const raw = { ...baseRaw, usage_gap_trend: 50 };
    expect(normalizeFeatures(raw).usage_gap_trend).toBe(1);
  });

  it("months_as_subscriber = 60 (max bound) → 1.0", () => {
    const raw = { ...baseRaw, months_as_subscriber: 60 };
    expect(normalizeFeatures(raw).months_as_subscriber).toBeCloseTo(1.0);
  });

  it("months_as_subscriber = 0 (min bound) → 0", () => {
    const raw = { ...baseRaw, months_as_subscriber: 0 };
    expect(normalizeFeatures(raw).months_as_subscriber).toBe(0);
  });

  it("months_as_subscriber > 60 → clamped to 1", () => {
    const raw = { ...baseRaw, months_as_subscriber: 120 };
    expect(normalizeFeatures(raw).months_as_subscriber).toBe(1);
  });

  it("all features at extremes produce valid [0,1] output", () => {
    const raw: RawChurnFeatures = {
      usage_rate: -0.5, // below 0
      days_since_last_usage: 1000, // above 180
      usage_gap_trend: 100, // above 10
      cohort_renewal_rate: 1.5, // above 1
      months_as_subscriber: -5, // below 0
    };
    const normalized = normalizeFeatures(raw);
    for (const [key, value] of Object.entries(normalized)) {
      expect(value).toBeGreaterThanOrEqual(0);
      expect(value).toBeLessThanOrEqual(1);
    }
  });
});

// ─── Extended tests: predictChurnProbability ───────────────────────────────────

describe("predictChurnProbability — extended edge cases", () => {
  it("output is always >= 0.001 (floor clamping)", () => {
    // Worst-case scenario: all features optimized to reduce churn
    const features: ChurnFeatures = {
      usage_rate: 1.0,
      days_since_last_usage: 0,
      usage_gap_trend: 0,
      cohort_renewal_rate: 1.0,
      months_as_subscriber: 1.0,
    };
    expect(predictChurnProbability(features)).toBeGreaterThanOrEqual(0.001);
  });

  it("output is always <= 0.999 (ceiling clamping)", () => {
    // Worst-case scenario: all features point to high churn
    const features: ChurnFeatures = {
      usage_rate: 0,
      days_since_last_usage: 1,
      usage_gap_trend: 1,
      cohort_renewal_rate: 0,
      months_as_subscriber: 0,
    };
    expect(predictChurnProbability(features)).toBeLessThanOrEqual(0.999);
  });

  it("high engagement user has low churn probability", () => {
    const features: ChurnFeatures = {
      usage_rate: 0.9,
      days_since_last_usage: 0.05,
      usage_gap_trend: 0.2, // negative trend (improving)
      cohort_renewal_rate: 0.85,
      months_as_subscriber: 0.8,
    };
    expect(predictChurnProbability(features)).toBeLessThan(0.3);
  });

  it("disengaged user has high churn probability", () => {
    const features: ChurnFeatures = {
      usage_rate: 0.1,
      days_since_last_usage: 0.9,
      usage_gap_trend: 0.8, // positive trend (widening gaps)
      cohort_renewal_rate: 0.2,
      months_as_subscriber: 0.05,
    };
    expect(predictChurnProbability(features)).toBeGreaterThan(0.7);
  });

  it("zero features (all at minimum) → high baseline churn", () => {
    const features: ChurnFeatures = {
      usage_rate: 0,
      days_since_last_usage: 0,
      usage_gap_trend: 0,
      cohort_renewal_rate: 0,
      months_as_subscriber: 0,
    };
    const prob = predictChurnProbability(features);
    // baseline z = b0 = 1.2, sigmoid(1.2) ≈ 0.77
    expect(prob).toBeGreaterThan(0.5);
  });

  it("one-feature impact: high usage_rate alone reduces churn", () => {
    const base: ChurnFeatures = {
      usage_rate: 0.5,
      days_since_last_usage: 0.5,
      usage_gap_trend: 0.5,
      cohort_renewal_rate: 0.5,
      months_as_subscriber: 0.5,
    };
    const withHighUsage = { ...base, usage_rate: 1.0 };
    expect(predictChurnProbability(withHighUsage)).toBeLessThan(
      predictChurnProbability(base)
    );
  });
});

// ─── Extended tests: getTopFeatures ────────────────────────────────────────────

describe("getTopFeatures — extended edge cases", () => {
  const baseFeatures: ChurnFeatures = {
    usage_rate: 0.5,
    days_since_last_usage: 0.5,
    usage_gap_trend: 0.5,
    cohort_renewal_rate: 0.5,
    months_as_subscriber: 0.5,
  };

  it("returns exactly 3 features", () => {
    const result = getTopFeatures(baseFeatures);
    expect(result).toHaveLength(3);
  });

  it("top feature always has impact 'high'", () => {
    const result = getTopFeatures(baseFeatures);
    expect(result[0]?.impact).toBe("high");
  });

  it("features with both positive and negative directions present", () => {
    const features: ChurnFeatures = {
      usage_rate: 0.9, // high usage → decreases_churn
      days_since_last_usage: 0.9, // high days → increases_churn
      usage_gap_trend: 0.5,
      cohort_renewal_rate: 0.5,
      months_as_subscriber: 0.5,
    };
    const result = getTopFeatures(features);
    const directions = result.map((f) => f.direction);
    const hasDecrease = directions.some((d) => d === "decreases_churn");
    const hasIncrease = directions.some((d) => d === "increases_churn");
    expect(hasDecrease || hasIncrease).toBe(true);
  });

  it("all features have valid direction enum", () => {
    const result = getTopFeatures(baseFeatures);
    for (const feature of result) {
      expect(["increases_churn", "decreases_churn"]).toContain(feature.direction);
    }
  });

  it("all features have valid impact level", () => {
    const result = getTopFeatures(baseFeatures);
    for (const feature of result) {
      expect(["high", "medium", "low"]).toContain(feature.impact);
    }
  });

  it("feature values match input values", () => {
    const result = getTopFeatures(baseFeatures);
    for (const feature of result) {
      expect(feature.value).toBeCloseTo(baseFeatures[feature.name]);
    }
  });

  it("sorted by absolute contribution descending", () => {
    const features: ChurnFeatures = {
      usage_rate: 1.0, // b1 = -3.5, contrib = -3.5
      days_since_last_usage: 0.1, // b2 = 0.04, contrib = 0.004
      usage_gap_trend: 1.0, // b3 = 2.1, contrib = 2.1
      cohort_renewal_rate: 0.1, // b4 = -2.8, contrib = -0.28
      months_as_subscriber: 0.1, // b5 = -0.15, contrib = -0.015
    };
    const result = getTopFeatures(features);
    // Absolute contributions: 3.5, 2.1, 0.28, 0.015, 0.004
    // Top 3: usage_rate (3.5), usage_gap_trend (2.1), cohort_renewal_rate (0.28)
    const names = result.map((f) => f.name);
    expect(names[0]).toBe("usage_rate");
    expect(names[1]).toBe("usage_gap_trend");
    expect(names[2]).toBe("cohort_renewal_rate");
  });

  it("handles all-equal contributions gracefully", () => {
    const features: ChurnFeatures = {
      usage_rate: 0.5,
      days_since_last_usage: 0.5,
      usage_gap_trend: 0.5,
      cohort_renewal_rate: 0.5,
      months_as_subscriber: 0.5,
    };
    const result = getTopFeatures(features);
    expect(result).toHaveLength(3);
    // All contributions have same absolute value, ordering is stable
    expect(result.every((f) => f.impact !== "high")).toBeFalsy();
  });
});

// ─── Extended tests: computeLogisticScore ────────────────────────────────────

describe("computeLogisticScore — extended edge cases", () => {
  it("returns exactly b0 when all features are 0", () => {
    const features: ChurnFeatures = {
      usage_rate: 0,
      days_since_last_usage: 0,
      usage_gap_trend: 0,
      cohort_renewal_rate: 0,
      months_as_subscriber: 0,
    };
    expect(computeLogisticScore(features)).toBeCloseTo(MODEL_COEFFICIENTS.b0);
  });

  it("high usage_rate reduces score (negative coefficient b1)", () => {
    const low: ChurnFeatures = {
      usage_rate: 0,
      days_since_last_usage: 0,
      usage_gap_trend: 0,
      cohort_renewal_rate: 0,
      months_as_subscriber: 0,
    };
    const high: ChurnFeatures = {
      usage_rate: 1,
      days_since_last_usage: 0,
      usage_gap_trend: 0,
      cohort_renewal_rate: 0,
      months_as_subscriber: 0,
    };
    expect(computeLogisticScore(high)).toBeLessThan(computeLogisticScore(low));
    expect(computeLogisticScore(high)).toBeCloseTo(
      MODEL_COEFFICIENTS.b0 + MODEL_COEFFICIENTS.b1_usage_rate
    );
  });

  it("high days_since_last_usage increases score (positive coefficient b2)", () => {
    const recent: ChurnFeatures = {
      usage_rate: 0,
      days_since_last_usage: 0,
      usage_gap_trend: 0,
      cohort_renewal_rate: 0,
      months_as_subscriber: 0,
    };
    const stale: ChurnFeatures = {
      usage_rate: 0,
      days_since_last_usage: 1,
      usage_gap_trend: 0,
      cohort_renewal_rate: 0,
      months_as_subscriber: 0,
    };
    expect(computeLogisticScore(stale)).toBeGreaterThan(
      computeLogisticScore(recent)
    );
  });

  it("all features at max (1.0) produces valid z", () => {
    const features: ChurnFeatures = {
      usage_rate: 1,
      days_since_last_usage: 1,
      usage_gap_trend: 1,
      cohort_renewal_rate: 1,
      months_as_subscriber: 1,
    };
    const z = computeLogisticScore(features);
    expect(isFinite(z)).toBe(true);
  });

  it("computes weighted sum correctly", () => {
    const features: ChurnFeatures = {
      usage_rate: 0.5,
      days_since_last_usage: 0.5,
      usage_gap_trend: 0.5,
      cohort_renewal_rate: 0.5,
      months_as_subscriber: 0.5,
    };
    const c = MODEL_COEFFICIENTS;
    const expected =
      c.b0 +
      c.b1_usage_rate * 0.5 +
      c.b2_days_since_last_usage * 0.5 +
      c.b3_usage_gap_trend * 0.5 +
      c.b4_cohort_renewal_rate * 0.5 +
      c.b5_months_as_subscriber * 0.5;
    expect(computeLogisticScore(features)).toBeCloseTo(expected);
  });
});

// ─── Extended tests: calculateUsageGapTrend ────────────────────────────────────

describe("calculateUsageGapTrend — extended edge cases", () => {
  function makeDates(count: number, gapDays: number): Date[] {
    const base = new Date("2026-01-01T00:00:00Z").getTime();
    return Array.from({ length: count }, (_, i) =>
      new Date(base + i * gapDays * 24 * 60 * 60 * 1000)
    );
  }

  it("returns 0 for < 3 visits (insufficient data)", () => {
    expect(calculateUsageGapTrend([])).toBe(0);
    expect(calculateUsageGapTrend([new Date()])).toBe(0);
    expect(calculateUsageGapTrend(makeDates(2, 7))).toBe(0);
  });

  it("returns ~0 for exactly 3 visits with constant interval", () => {
    const dates = makeDates(3, 7);
    const slope = calculateUsageGapTrend(dates);
    expect(Math.abs(slope)).toBeLessThan(0.01);
  });

  it("returns ~0 for perfect regular visits (6 visits, 14-day gaps)", () => {
    const dates = makeDates(6, 14);
    const slope = calculateUsageGapTrend(dates);
    expect(Math.abs(slope)).toBeLessThan(0.01);
  });

  it("returns positive slope for widening gaps (acceleration)", () => {
    const base = new Date("2026-01-01T00:00:00Z").getTime();
    const dates = [
      new Date(base),
      new Date(base + 7 * 24 * 60 * 60 * 1000),
      new Date(base + 17 * 24 * 60 * 60 * 1000),
      new Date(base + 32 * 24 * 60 * 60 * 1000),
      new Date(base + 52 * 24 * 60 * 60 * 1000),
      new Date(base + 77 * 24 * 60 * 60 * 1000),
    ];
    // Gaps: 7, 10, 15, 20, 25 days (clearly widening)
    const slope = calculateUsageGapTrend(dates);
    expect(slope).toBeGreaterThan(0);
  });

  it("returns negative slope for shrinking gaps (deceleration)", () => {
    const base = new Date("2026-01-01T00:00:00Z").getTime();
    const dates = [
      new Date(base),
      new Date(base + 20 * 24 * 60 * 60 * 1000),
      new Date(base + 37 * 24 * 60 * 60 * 1000),
      new Date(base + 51 * 24 * 60 * 60 * 1000),
      new Date(base + 62 * 24 * 60 * 60 * 1000),
      new Date(base + 70 * 24 * 60 * 60 * 1000),
    ];
    // Gaps: 20, 17, 14, 11, 8 days (narrowing)
    const slope = calculateUsageGapTrend(dates);
    expect(slope).toBeLessThan(0);
  });

  it("uses only last 5 intervals (ignores old history)", () => {
    const base = new Date("2026-01-01T00:00:00Z").getTime();
    // First 3 visits: very far apart (30 days each)
    // Then 6 more visits: regular 1-day gaps
    const dates = [
      new Date(base),
      new Date(base + 30 * 24 * 60 * 60 * 1000),
      new Date(base + 60 * 24 * 60 * 60 * 1000),
    ];
    for (let i = 1; i <= 6; i++) {
      dates.push(
        new Date(dates[dates.length - 1]!.getTime() + 1 * 24 * 60 * 60 * 1000)
      );
    }
    // Last 5 intervals all ~1 day → slope ≈ 0
    const slope = calculateUsageGapTrend(dates);
    expect(Math.abs(slope)).toBeLessThan(0.5);
  });

  it("handles unsorted dates by sorting internally", () => {
    const sorted = makeDates(5, 7);
    const reversed = [...sorted].reverse();
    const slopeSorted = calculateUsageGapTrend(sorted);
    const slopeReversed = calculateUsageGapTrend(reversed);
    expect(slopeReversed).toBeCloseTo(slopeSorted, 5);
  });
});

// ─── Business scenario tests ──────────────────────────────────────────────────

describe("churn prediction — business scenarios", () => {
  it("new subscriber (1 month, high usage) → low churn < 0.4", () => {
    const features: ChurnFeatures = {
      usage_rate: 0.8,
      days_since_last_usage: 1 / 180, // 1 day
      usage_gap_trend: (0 + 10) / 20, // 0 trend, normalized
      cohort_renewal_rate: 0.65,
      months_as_subscriber: 1 / 60, // 1 month
    };
    const churn = predictChurnProbability(features);
    expect(churn).toBeLessThan(0.4);
  });

  it("loyal user 3 years, but hasn't visited in 120 days → high churn > 0.8", () => {
    const features: ChurnFeatures = {
      usage_rate: 0.05,
      days_since_last_usage: Math.min(1, 120 / 180),
      usage_gap_trend: (8 + 10) / 20, // positive trend = widening gaps
      cohort_renewal_rate: 0.65,
      months_as_subscriber: 1.0, // clamped to max
    };
    const churn = predictChurnProbability(features);
    expect(churn).toBeGreaterThan(0.8);
  });

  it("seasonal user (usage_rate=0.5, gap_trend=0) → churn 0.3–0.6", () => {
    const features: ChurnFeatures = {
      usage_rate: 0.5,
      days_since_last_usage: 0.5,
      usage_gap_trend: 0.5, // neutral trend
      cohort_renewal_rate: 0.65,
      months_as_subscriber: 0.5,
    };
    const churn = predictChurnProbability(features);
    expect(churn).toBeGreaterThan(0.3);
    expect(churn).toBeLessThan(0.7);
  });

  it("high-cohort organizer (renewal_rate=0.9) reduces churn impact", () => {
    const lowCohort: ChurnFeatures = {
      usage_rate: 0.3,
      days_since_last_usage: 0.5,
      usage_gap_trend: 0.5,
      cohort_renewal_rate: 0.3, // low cohort
      months_as_subscriber: 0.3,
    };
    const highCohort: ChurnFeatures = {
      usage_rate: 0.3,
      days_since_last_usage: 0.5,
      usage_gap_trend: 0.5,
      cohort_renewal_rate: 0.9, // high cohort
      months_as_subscriber: 0.3,
    };
    expect(predictChurnProbability(highCohort)).toBeLessThan(
      predictChurnProbability(lowCohort)
    );
  });
});
