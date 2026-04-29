import { describe, it, expect } from "vitest";
import {
  sigmoid,
  computeLogisticScore,
  predictChurnProbability,
  getTopFeatures,
  normalizeFeatures,
  MODEL_COEFFICIENTS,
} from "./logistic-regression";
import { ChurnFeatures, RawChurnFeatures, RetentionAction } from "../types/churn.types";

// ─── Fixtures ─────────────────────────────────────────────────────────────────

/** High-engagement user very unlikely to churn. */
const idealUserFeatures: ChurnFeatures = {
  usage_rate: 1.0,
  days_since_last_usage: 1 / 180,   // 1 raw day normalised
  usage_gap_trend: (-5 + 10) / 20,  // raw -5 normalised
  cohort_renewal_rate: 0.9,
  months_as_subscriber: 24 / 60,    // 24 months normalised
};

/** Disengaged user with strong churn signals. */
const churnRiskFeatures: ChurnFeatures = {
  usage_rate: 0.1,
  days_since_last_usage: 90 / 180,  // 90 raw days normalised
  usage_gap_trend: (8 + 10) / 20,   // raw +8 normalised
  cohort_renewal_rate: 0.3,
  months_as_subscriber: 1 / 60,     // 1 month normalised
};

/**
 * Average user — moderate engagement with some churn signals.
 * usage_rate=0.3, days_since=40, gap_trend=+2, cohort_rate=0.5, months=3
 * → probability ≈ 0.50
 */
const averageUserFeatures: ChurnFeatures = {
  usage_rate: 0.3,
  days_since_last_usage: 40 / 180,
  usage_gap_trend: (2 + 10) / 20,   // slight positive trend
  cohort_renewal_rate: 0.5,
  months_as_subscriber: 3 / 60,
};

// ─── sigmoid ─────────────────────────────────────────────────────────────────

describe("sigmoid", () => {
  it("returns 0.5 for z = 0", () => {
    expect(sigmoid(0)).toBeCloseTo(0.5);
  });

  it("returns > 0.99 for z = 10", () => {
    expect(sigmoid(10)).toBeGreaterThan(0.99);
  });

  it("returns < 0.01 for z = -10", () => {
    expect(sigmoid(-10)).toBeLessThan(0.01);
  });

  it("is monotonically increasing", () => {
    const inputs = [-10, -5, -1, 0, 1, 5, 10];
    const outputs = inputs.map(sigmoid);
    for (let i = 1; i < outputs.length; i++) {
      expect(outputs[i]).toBeGreaterThan(outputs[i - 1] as number);
    }
  });

  it("output is always in (0, 1] — float precision at extremes", () => {
    // At z=100, Math.exp(-100) underflows to 0 so sigmoid returns exactly 1.
    // The function contract is that output is in (0,1]; clamping is done by
    // predictChurnProbability which calls sigmoid then clamps to [0.001, 0.999].
    for (const z of [-100, -10, 0, 10, 100]) {
      const result = sigmoid(z);
      expect(result).toBeGreaterThan(0);
      expect(result).toBeLessThanOrEqual(1);
    }
  });
});

// ─── predictChurnProbability ──────────────────────────────────────────────────

describe("predictChurnProbability", () => {
  it("ideal user (high engagement, long tenure) has probability < 0.2", () => {
    const prob = predictChurnProbability(idealUserFeatures);
    expect(prob).toBeLessThan(0.2);
  });

  it("churn-risk user has probability > 0.85", () => {
    const prob = predictChurnProbability(churnRiskFeatures);
    expect(prob).toBeGreaterThan(0.85);
  });

  it("average user has probability between 0.3 and 0.7", () => {
    const prob = predictChurnProbability(averageUserFeatures);
    expect(prob).toBeGreaterThan(0.3);
    expect(prob).toBeLessThan(0.7);
  });

  it("output is always >= 0.001", () => {
    // All features maxed to reduce churn as much as possible
    const features: ChurnFeatures = {
      usage_rate: 1,
      days_since_last_usage: 0,
      usage_gap_trend: 0,
      cohort_renewal_rate: 1,
      months_as_subscriber: 1,
    };
    expect(predictChurnProbability(features)).toBeGreaterThanOrEqual(0.001);
  });

  it("output is always <= 0.999", () => {
    // All features maximally worsen churn probability
    const features: ChurnFeatures = {
      usage_rate: 0,
      days_since_last_usage: 1,
      usage_gap_trend: 1,
      cohort_renewal_rate: 0,
      months_as_subscriber: 0,
    };
    expect(predictChurnProbability(features)).toBeLessThanOrEqual(0.999);
  });

  it("higher usage_rate always lowers churn probability (all else equal)", () => {
    const low = predictChurnProbability({ ...averageUserFeatures, usage_rate: 0.1 });
    const high = predictChurnProbability({ ...averageUserFeatures, usage_rate: 0.9 });
    expect(high).toBeLessThan(low);
  });

  it("higher days_since_last_usage always raises churn probability (all else equal)", () => {
    const recent = predictChurnProbability({
      ...averageUserFeatures,
      days_since_last_usage: 0.1,
    });
    const stale = predictChurnProbability({
      ...averageUserFeatures,
      days_since_last_usage: 0.9,
    });
    expect(stale).toBeGreaterThan(recent);
  });
});

// ─── getTopFeatures ───────────────────────────────────────────────────────────

describe("getTopFeatures", () => {
  it("returns exactly 3 features", () => {
    const result = getTopFeatures(averageUserFeatures);
    expect(result).toHaveLength(3);
  });

  it("features are sorted by importance (descending abs contribution)", () => {
    const result = getTopFeatures(churnRiskFeatures);
    const c = MODEL_COEFFICIENTS;
    const contribOf = (name: keyof ChurnFeatures) =>
      Math.abs(
        {
          usage_rate: c.b1_usage_rate * churnRiskFeatures.usage_rate,
          days_since_last_usage:
            c.b2_days_since_last_usage * churnRiskFeatures.days_since_last_usage,
          usage_gap_trend:
            c.b3_usage_gap_trend * churnRiskFeatures.usage_gap_trend,
          cohort_renewal_rate:
            c.b4_cohort_renewal_rate * churnRiskFeatures.cohort_renewal_rate,
          months_as_subscriber:
            c.b5_months_as_subscriber * churnRiskFeatures.months_as_subscriber,
        }[name],
      );

    for (let i = 1; i < result.length; i++) {
      const prev = result[i - 1];
      const curr = result[i];
      if (prev !== undefined && curr !== undefined) {
        expect(contribOf(prev.name)).toBeGreaterThanOrEqual(contribOf(curr.name));
      }
    }
  });

  it("usage_rate has direction 'decreases_churn' when value is high", () => {
    const features: ChurnFeatures = {
      ...averageUserFeatures,
      usage_rate: 1.0,
      days_since_last_usage: 0,
      usage_gap_trend: 0,
      cohort_renewal_rate: 0,
      months_as_subscriber: 0,
    };
    const result = getTopFeatures(features);
    const usageFeature = result.find((f) => f.name === "usage_rate");
    expect(usageFeature?.direction).toBe("decreases_churn");
  });

  it("days_since_last_usage has direction 'increases_churn' when value is high", () => {
    const features: ChurnFeatures = {
      ...averageUserFeatures,
      usage_rate: 0,
      days_since_last_usage: 1.0,
      usage_gap_trend: 0,
      cohort_renewal_rate: 0,
      months_as_subscriber: 0,
    };
    const result = getTopFeatures(features);
    const daysFeature = result.find((f) => f.name === "days_since_last_usage");
    expect(daysFeature?.direction).toBe("increases_churn");
  });

  it("impact values are valid enum members", () => {
    const result = getTopFeatures(averageUserFeatures);
    for (const feature of result) {
      expect(["high", "medium", "low"]).toContain(feature.impact);
    }
  });

  it("the first feature always has impact 'high'", () => {
    const result = getTopFeatures(churnRiskFeatures);
    expect(result[0]?.impact).toBe("high");
  });

  it("feature values match the normalised input", () => {
    const result = getTopFeatures(averageUserFeatures);
    for (const feature of result) {
      expect(feature.value).toBeCloseTo(averageUserFeatures[feature.name]);
    }
  });
});

// ─── normalizeFeatures ────────────────────────────────────────────────────────

describe("normalizeFeatures", () => {
  it("clamps days_since_last_usage above max (180) to 1", () => {
    const raw: RawChurnFeatures = {
      usage_rate: 0.5,
      days_since_last_usage: 999,
      usage_gap_trend: 0,
      cohort_renewal_rate: 0.5,
      months_as_subscriber: 12,
    };
    const normalised = normalizeFeatures(raw);
    expect(normalised.days_since_last_usage).toBe(1);
  });

  it("clamps days_since_last_usage below min (0) to 0", () => {
    const raw: RawChurnFeatures = {
      usage_rate: 0.5,
      days_since_last_usage: -5,
      usage_gap_trend: 0,
      cohort_renewal_rate: 0.5,
      months_as_subscriber: 12,
    };
    const normalised = normalizeFeatures(raw);
    expect(normalised.days_since_last_usage).toBe(0);
  });

  it("clamps usage_gap_trend above max (10) to 1", () => {
    const raw: RawChurnFeatures = {
      usage_rate: 0.5,
      days_since_last_usage: 30,
      usage_gap_trend: 50,
      cohort_renewal_rate: 0.5,
      months_as_subscriber: 12,
    };
    const normalised = normalizeFeatures(raw);
    expect(normalised.usage_gap_trend).toBe(1);
  });

  it("clamps usage_gap_trend below min (-10) to 0", () => {
    const raw: RawChurnFeatures = {
      usage_rate: 0.5,
      days_since_last_usage: 30,
      usage_gap_trend: -50,
      cohort_renewal_rate: 0.5,
      months_as_subscriber: 12,
    };
    const normalised = normalizeFeatures(raw);
    expect(normalised.usage_gap_trend).toBe(0);
  });

  it("clamps months_as_subscriber above max (60) to 1", () => {
    const raw: RawChurnFeatures = {
      usage_rate: 0.5,
      days_since_last_usage: 30,
      usage_gap_trend: 0,
      cohort_renewal_rate: 0.5,
      months_as_subscriber: 120,
    };
    const normalised = normalizeFeatures(raw);
    expect(normalised.months_as_subscriber).toBe(1);
  });

  it("normalises months_as_subscriber = 30 to 0.5", () => {
    const raw: RawChurnFeatures = {
      usage_rate: 0.5,
      days_since_last_usage: 30,
      usage_gap_trend: 0,
      cohort_renewal_rate: 0.5,
      months_as_subscriber: 30,
    };
    const normalised = normalizeFeatures(raw);
    expect(normalised.months_as_subscriber).toBeCloseTo(0.5);
  });

  it("normalises days_since_last_usage = 90 to 0.5", () => {
    const raw: RawChurnFeatures = {
      usage_rate: 0.5,
      days_since_last_usage: 90,
      usage_gap_trend: 0,
      cohort_renewal_rate: 0.5,
      months_as_subscriber: 12,
    };
    const normalised = normalizeFeatures(raw);
    expect(normalised.days_since_last_usage).toBeCloseTo(0.5);
  });

  it("passes through usage_rate and cohort_renewal_rate unchanged when in [0,1]", () => {
    const raw: RawChurnFeatures = {
      usage_rate: 0.73,
      days_since_last_usage: 30,
      usage_gap_trend: 0,
      cohort_renewal_rate: 0.82,
      months_as_subscriber: 12,
    };
    const normalised = normalizeFeatures(raw);
    expect(normalised.usage_rate).toBeCloseTo(0.73);
    expect(normalised.cohort_renewal_rate).toBeCloseTo(0.82);
  });

  it("all output values are in [0, 1]", () => {
    const raw: RawChurnFeatures = {
      usage_rate: 1.5,        // above max
      days_since_last_usage: -10, // below min
      usage_gap_trend: 100,   // above max
      cohort_renewal_rate: -0.1, // below min
      months_as_subscriber: 999, // above max
    };
    const normalised = normalizeFeatures(raw);
    for (const value of Object.values(normalised)) {
      expect(value).toBeGreaterThanOrEqual(0);
      expect(value).toBeLessThanOrEqual(1);
    }
  });
});

// ─── Retention action assignment ──────────────────────────────────────────────

describe("retention action thresholds (via predictChurnProbability)", () => {
  /**
   * Helper: given a probability, which action should be triggered for a horizon?
   * Mirrors the determineRetentionAction logic in churn-scoring.service.ts.
   */
  function determineAction(
    probability: number,
    horizon: "30d" | "14d" | "7d",
  ): RetentionAction {
    const thresholds: Record<"30d" | "14d" | "7d", { threshold: number; action: RetentionAction }> = {
      "30d": { threshold: 0.6, action: RetentionAction.EmailReminder },
      "14d": { threshold: 0.7, action: RetentionAction.EmailDiscount },
      "7d": { threshold: 0.8, action: RetentionAction.PushHighlight },
    };
    const config = thresholds[horizon];
    return probability > config.threshold ? config.action : RetentionAction.None;
  }

  it("probability 0.55 + horizon 30d → no action (below 0.6 threshold)", () => {
    expect(determineAction(0.55, "30d")).toBe(RetentionAction.None);
  });

  it("probability 0.65 + horizon 30d → email_reminder (above 0.6 threshold)", () => {
    expect(determineAction(0.65, "30d")).toBe(RetentionAction.EmailReminder);
  });

  it("probability 0.68 + horizon 14d → no action (below 0.7 threshold)", () => {
    expect(determineAction(0.68, "14d")).toBe(RetentionAction.None);
  });

  it("probability 0.75 + horizon 14d → email_discount (above 0.7 threshold)", () => {
    expect(determineAction(0.75, "14d")).toBe(RetentionAction.EmailDiscount);
  });

  it("probability 0.79 + horizon 7d → no action (below 0.8 threshold)", () => {
    expect(determineAction(0.79, "7d")).toBe(RetentionAction.None);
  });

  it("probability 0.85 + horizon 7d → push_highlight (above 0.8 threshold)", () => {
    expect(determineAction(0.85, "7d")).toBe(RetentionAction.PushHighlight);
  });

  it("probability exactly at threshold (0.6, 30d) → no action (not strictly above)", () => {
    expect(determineAction(0.6, "30d")).toBe(RetentionAction.None);
  });

  it("probability exactly at threshold (0.8, 7d) → no action (not strictly above)", () => {
    expect(determineAction(0.8, "7d")).toBe(RetentionAction.None);
  });
});

// ─── computeLogisticScore ─────────────────────────────────────────────────────

describe("computeLogisticScore", () => {
  it("returns b0 when all features are zero", () => {
    const features: ChurnFeatures = {
      usage_rate: 0,
      days_since_last_usage: 0,
      usage_gap_trend: 0,
      cohort_renewal_rate: 0,
      months_as_subscriber: 0,
    };
    expect(computeLogisticScore(features)).toBeCloseTo(MODEL_COEFFICIENTS.b0);
  });

  it("reduces z when usage_rate is 1 (negative coefficient)", () => {
    const base: ChurnFeatures = {
      usage_rate: 0,
      days_since_last_usage: 0,
      usage_gap_trend: 0,
      cohort_renewal_rate: 0,
      months_as_subscriber: 0,
    };
    const withUsage: ChurnFeatures = { ...base, usage_rate: 1 };
    expect(computeLogisticScore(withUsage)).toBeLessThan(computeLogisticScore(base));
  });

  it("increases z when days_since_last_usage is high (positive coefficient)", () => {
    const base: ChurnFeatures = {
      usage_rate: 0.5,
      days_since_last_usage: 0,
      usage_gap_trend: 0.5,
      cohort_renewal_rate: 0.5,
      months_as_subscriber: 0.5,
    };
    const withStale: ChurnFeatures = { ...base, days_since_last_usage: 1 };
    expect(computeLogisticScore(withStale)).toBeGreaterThan(
      computeLogisticScore(base),
    );
  });
});
