import { describe, it, expect } from "vitest";
import { calculateUsageGapTrend } from "./feature-extractor";
import { normalizeFeatures } from "./logistic-regression";
import type { RawChurnFeatures } from "../types/churn.types";

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Creates an ordered list of Date objects spaced evenly by `gapDays`. */
function makeRegularDates(count: number, gapDays: number): Date[] {
  const base = new Date("2026-01-01T00:00:00Z").getTime();
  const dates: Date[] = [];
  for (let i = 0; i < count; i++) {
    dates.push(new Date(base + i * gapDays * 24 * 60 * 60 * 1000));
  }
  return dates;
}

/**
 * Creates dates with accelerating gaps.
 * Gaps: [gapDays, gapDays + delta, gapDays + 2*delta, …]
 */
function makeAcceleratingDates(count: number, startGap: number, delta: number): Date[] {
  const base = new Date("2026-01-01T00:00:00Z").getTime();
  const dates: Date[] = [new Date(base)];
  let cursor = base;
  for (let i = 0; i < count - 1; i++) {
    cursor += (startGap + i * delta) * 24 * 60 * 60 * 1000;
    dates.push(new Date(cursor));
  }
  return dates;
}

/**
 * Creates dates with decelerating gaps (shrinking intervals).
 * Gaps: [startGap, startGap - delta, startGap - 2*delta, …]
 */
function makeDeceleratingDates(count: number, startGap: number, delta: number): Date[] {
  const base = new Date("2026-01-01T00:00:00Z").getTime();
  const dates: Date[] = [new Date(base)];
  let cursor = base;
  for (let i = 0; i < count - 1; i++) {
    const gap = Math.max(1, startGap - i * delta);
    cursor += gap * 24 * 60 * 60 * 1000;
    dates.push(new Date(cursor));
  }
  return dates;
}

// ─── calculateUsageGapTrend ───────────────────────────────────────────────────

describe("calculateUsageGapTrend", () => {
  it("returns 0 for empty array (0 visits)", () => {
    expect(calculateUsageGapTrend([])).toBe(0);
  });

  it("returns 0 for a single visit (< 3 visits)", () => {
    expect(calculateUsageGapTrend([new Date()])).toBe(0);
  });

  it("returns 0 for exactly 2 visits (< 3 visits)", () => {
    const dates = makeRegularDates(2, 7);
    expect(calculateUsageGapTrend(dates)).toBe(0);
  });

  it("returns 0 for exactly 3 visits with constant interval (slope ≈ 0)", () => {
    const dates = makeRegularDates(3, 7);
    const slope = calculateUsageGapTrend(dates);
    expect(Math.abs(slope)).toBeLessThan(0.01);
  });

  it("returns ≈ 0 for 6 perfectly regular visits (constant gap)", () => {
    const dates = makeRegularDates(6, 14);
    const slope = calculateUsageGapTrend(dates);
    expect(Math.abs(slope)).toBeLessThan(0.01);
  });

  it("returns positive slope when intervals are growing (churn signal)", () => {
    // Gaps: 7, 10, 13, 16, 19 days → clearly widening
    const dates = makeAcceleratingDates(6, 7, 3);
    const slope = calculateUsageGapTrend(dates);
    expect(slope).toBeGreaterThan(0);
  });

  it("returns negative slope when intervals are shrinking (engagement returning)", () => {
    // Gaps: 20, 17, 14, 11, 8 days → narrowing
    const dates = makeDeceleratingDates(6, 20, 3);
    const slope = calculateUsageGapTrend(dates);
    expect(slope).toBeLessThan(0);
  });

  it("uses only the last 5 intervals (ignores older history)", () => {
    // First 2 visits: very far apart (30 days each)
    // Next 6 visits: regular 1-day gaps → recent trend should be ~0 slope
    const base = new Date("2026-01-01T00:00:00Z").getTime();
    const dates: Date[] = [
      new Date(base),
      new Date(base + 30 * 24 * 3600 * 1000),
      new Date(base + 60 * 24 * 3600 * 1000),
    ];
    // Append 6 more visits with 1-day gaps
    for (let i = 1; i <= 6; i++) {
      dates.push(new Date(dates[dates.length - 1]!.getTime() + 1 * 24 * 3600 * 1000));
    }
    const slope = calculateUsageGapTrend(dates);
    // The last 5 intervals are all ~1 day → slope ≈ 0
    expect(Math.abs(slope)).toBeLessThan(0.5);
  });

  it("handles unsorted input dates by sorting them", () => {
    const base = new Date("2026-01-01T00:00:00Z").getTime();
    // Provide in reverse order — result should be same as sorted
    const sortedDates = makeRegularDates(4, 7);
    const reversedDates = [...sortedDates].reverse();
    const slopeSorted = calculateUsageGapTrend(sortedDates);
    const slopeReversed = calculateUsageGapTrend(reversedDates);
    expect(slopeReversed).toBeCloseTo(slopeSorted, 5);
  });

  it("strongly accelerating gaps yield high positive slope", () => {
    // Gaps double each time: 2, 4, 8, 16, 32 days
    const base = new Date("2026-01-01T00:00:00Z").getTime();
    const dates: Date[] = [new Date(base)];
    let cursor = base;
    const gaps = [2, 4, 8, 16, 32];
    for (const gap of gaps) {
      cursor += gap * 24 * 60 * 60 * 1000;
      dates.push(new Date(cursor));
    }
    const slope = calculateUsageGapTrend(dates);
    expect(slope).toBeGreaterThan(5);
  });
});

// ─── normalizeFeatures — usage_rate calculation logic ─────────────────────────

describe("normalizeFeatures — usage_rate range validation", () => {
  const baseRaw: RawChurnFeatures = {
    usage_rate: 0.5,
    days_since_last_usage: 30,
    usage_gap_trend: 0,
    cohort_renewal_rate: 0.65,
    months_as_subscriber: 12,
  };

  it("usage_rate = 0 (zero usage, flex pass not yet started) normalises to 0", () => {
    const raw = { ...baseRaw, usage_rate: 0 };
    expect(normalizeFeatures(raw).usage_rate).toBe(0);
  });

  it("usage_rate = 1 (all uses consumed for flex pass) normalises to 1", () => {
    const raw = { ...baseRaw, usage_rate: 1.0 };
    expect(normalizeFeatures(raw).usage_rate).toBeCloseTo(1.0);
  });

  it("usage_rate > 1 (over-performer on season pass) clamps to 1", () => {
    const raw = { ...baseRaw, usage_rate: 1.8 };
    expect(normalizeFeatures(raw).usage_rate).toBe(1);
  });

  it("usage_rate < 0 (data error) clamps to 0", () => {
    const raw = { ...baseRaw, usage_rate: -0.2 };
    expect(normalizeFeatures(raw).usage_rate).toBe(0);
  });

  it("season pass mid-usage (usage_rate = 0.6) normalises correctly", () => {
    const raw = { ...baseRaw, usage_rate: 0.6 };
    expect(normalizeFeatures(raw).usage_rate).toBeCloseTo(0.6);
  });

  it("flex pass 3/10 uses consumed → usage_rate = 0.3, normalises to 0.3", () => {
    // (10 - 7) / 10 = 0.3
    const raw = { ...baseRaw, usage_rate: 0.3 };
    expect(normalizeFeatures(raw).usage_rate).toBeCloseTo(0.3);
  });
});

// ─── normalizeFeatures — cohort_renewal_rate ──────────────────────────────────

describe("normalizeFeatures — cohort_renewal_rate", () => {
  const baseRaw: RawChurnFeatures = {
    usage_rate: 0.5,
    days_since_last_usage: 30,
    usage_gap_trend: 0,
    cohort_renewal_rate: 0.7,
    months_as_subscriber: 12,
  };

  it("cohort_renewal_rate = 0.7 (typical default) normalises to 0.7", () => {
    expect(normalizeFeatures(baseRaw).cohort_renewal_rate).toBeCloseTo(0.7);
  });

  it("cohort_renewal_rate = 1.0 stays at 1.0", () => {
    const raw = { ...baseRaw, cohort_renewal_rate: 1.0 };
    expect(normalizeFeatures(raw).cohort_renewal_rate).toBe(1);
  });

  it("cohort_renewal_rate = 0.0 stays at 0.0", () => {
    const raw = { ...baseRaw, cohort_renewal_rate: 0.0 };
    expect(normalizeFeatures(raw).cohort_renewal_rate).toBe(0);
  });
});
