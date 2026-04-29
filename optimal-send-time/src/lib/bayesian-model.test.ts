/**
 * Vitest unit tests — Bayesian Beta-Binomial model
 * min. 30 tests
 */

import { describe, it, expect } from 'vitest';
import {
  initHourPosteriors,
  initDayPosteriors,
  updatePosterior,
  applyEngagementEvents,
  getBestHour,
  getBestDay,
  normalizeToDistribution,
  calculateConfidence,
  isCohortFallback,
  PRIOR_STRENGTH,
  COLD_START_THRESHOLD,
  HOUR_PRIORS,
  DAY_PRIORS,
} from './bayesian-model';
import type { BetaDistribution } from '../types/send-time.types';

// ---------------------------------------------------------------------------
// initHourPosteriors
// ---------------------------------------------------------------------------

describe('initHourPosteriors', () => {
  const posteriors = initHourPosteriors();

  it('returns exactly 24 keys (hours 0–23)', () => {
    expect(Object.keys(posteriors)).toHaveLength(24);
    for (let h = 0; h < 24; h++) {
      expect(posteriors[h]).toBeDefined();
    }
  });

  it('every distribution has alpha > 0 and beta > 0', () => {
    for (let h = 0; h < 24; h++) {
      expect(posteriors[h].alpha).toBeGreaterThan(0);
      expect(posteriors[h].beta).toBeGreaterThan(0);
    }
  });

  it('posteriorMean equals alpha / (alpha + beta) for every hour', () => {
    for (let h = 0; h < 24; h++) {
      const { alpha, beta, posteriorMean } = posteriors[h];
      expect(posteriorMean).toBeCloseTo(alpha / (alpha + beta), 10);
    }
  });

  it('morning hours (7–9) have higher posteriorMean than night hours (1–4)', () => {
    const morningMin = Math.min(
      posteriors[7].posteriorMean,
      posteriors[8].posteriorMean,
      posteriors[9].posteriorMean
    );
    const nightMax = Math.max(
      posteriors[1].posteriorMean,
      posteriors[2].posteriorMean,
      posteriors[3].posteriorMean,
      posteriors[4].posteriorMean
    );
    expect(morningMin).toBeGreaterThan(nightMax);
  });

  it('sampleSize starts at 0 for all hours', () => {
    for (let h = 0; h < 24; h++) {
      expect(posteriors[h].sampleSize).toBe(0);
    }
  });

  it('alpha + beta equals PRIOR_STRENGTH for each hour', () => {
    for (let h = 0; h < 24; h++) {
      expect(posteriors[h].alpha + posteriors[h].beta).toBeCloseTo(PRIOR_STRENGTH, 10);
    }
  });
});

// ---------------------------------------------------------------------------
// initDayPosteriors
// ---------------------------------------------------------------------------

describe('initDayPosteriors', () => {
  const posteriors = initDayPosteriors();

  it('returns exactly 7 keys (days 0–6)', () => {
    expect(Object.keys(posteriors)).toHaveLength(7);
  });

  it('Tuesday (1) and Wednesday (2) have higher posteriorMean than Sunday (6)', () => {
    expect(posteriors[1].posteriorMean).toBeGreaterThan(posteriors[6].posteriorMean);
    expect(posteriors[2].posteriorMean).toBeGreaterThan(posteriors[6].posteriorMean);
  });
});

// ---------------------------------------------------------------------------
// updatePosterior
// ---------------------------------------------------------------------------

describe('updatePosterior', () => {
  const base: BetaDistribution = { alpha: 3, beta: 7, posteriorMean: 0.3, sampleSize: 5 };

  it('wasOpened = true increases alpha by 1 and leaves beta unchanged', () => {
    const updated = updatePosterior(base, true);
    expect(updated.alpha).toBe(4);
    expect(updated.beta).toBe(7);
  });

  it('wasOpened = false increases beta by 1 and leaves alpha unchanged', () => {
    const updated = updatePosterior(base, false);
    expect(updated.alpha).toBe(3);
    expect(updated.beta).toBe(8);
  });

  it('posteriorMean is recalculated correctly after open', () => {
    const updated = updatePosterior(base, true);
    expect(updated.posteriorMean).toBeCloseTo(4 / 11, 10);
  });

  it('posteriorMean is recalculated correctly after no-open', () => {
    const updated = updatePosterior(base, false);
    expect(updated.posteriorMean).toBeCloseTo(3 / 11, 10);
  });

  it('sampleSize increases by 1 on open', () => {
    const updated = updatePosterior(base, true);
    expect(updated.sampleSize).toBe(6);
  });

  it('sampleSize increases by 1 on no-open', () => {
    const updated = updatePosterior(base, false);
    expect(updated.sampleSize).toBe(6);
  });

  it('is immutable — original object is not modified', () => {
    const snapshot = { ...base };
    updatePosterior(base, true);
    updatePosterior(base, false);
    expect(base).toEqual(snapshot);
  });
});

// ---------------------------------------------------------------------------
// applyEngagementEvents
// ---------------------------------------------------------------------------

describe('applyEngagementEvents', () => {
  it('empty events array returns the original posteriors unchanged', () => {
    const hour = initHourPosteriors();
    const day  = initDayPosteriors();
    const { hourPosteriors, dayPosteriors } = applyEngagementEvents(hour, day, []);
    expect(hourPosteriors).toBe(hour);
    expect(dayPosteriors).toBe(day);
  });

  it('a single event in hour 8 only updates hour 8', () => {
    const hour = initHourPosteriors();
    const day  = initDayPosteriors();
    const { hourPosteriors } = applyEngagementEvents(hour, day, [
      { hourOfDay: 8, dayOfWeek: 1, wasOpened: true },
    ]);

    expect(hourPosteriors[8].sampleSize).toBe(1);
    for (let h = 0; h < 24; h++) {
      if (h !== 8) expect(hourPosteriors[h].sampleSize).toBe(0);
    }
  });

  it('multiple events produce a cumulative update', () => {
    const hour = initHourPosteriors();
    const day  = initDayPosteriors();
    const events = [
      { hourOfDay: 9, dayOfWeek: 0, wasOpened: true  },
      { hourOfDay: 9, dayOfWeek: 0, wasOpened: true  },
      { hourOfDay: 9, dayOfWeek: 0, wasOpened: false },
    ];
    const { hourPosteriors } = applyEngagementEvents(hour, day, events);
    expect(hourPosteriors[9].sampleSize).toBe(3);
    expect(hourPosteriors[9].alpha).toBeCloseTo(HOUR_PRIORS[9] + 2, 10);
    expect(hourPosteriors[9].beta).toBeCloseTo(PRIOR_STRENGTH - HOUR_PRIORS[9] + 1, 10);
  });

  it('after 20 opens in hour 9, hour 9 has the highest posteriorMean', () => {
    const hour = initHourPosteriors();
    const day  = initDayPosteriors();
    const events = Array.from({ length: 20 }, () => ({
      hourOfDay: 9,
      dayOfWeek: 2,
      wasOpened: true,
    }));
    const { hourPosteriors } = applyEngagementEvents(hour, day, events);
    const best = getBestHour(hourPosteriors);
    expect(best).toBe(9);
  });

  it('events with out-of-range hour are silently ignored', () => {
    const hour = initHourPosteriors();
    const day  = initDayPosteriors();
    const before = { ...hour };
    const { hourPosteriors } = applyEngagementEvents(hour, day, [
      { hourOfDay: 99, dayOfWeek: 0, wasOpened: true },
    ]);
    for (let h = 0; h < 24; h++) {
      expect(hourPosteriors[h].sampleSize).toBe(before[h].sampleSize);
    }
  });
});

// ---------------------------------------------------------------------------
// getBestHour
// ---------------------------------------------------------------------------

describe('getBestHour', () => {
  it('with default prior returns hour 8 (highest HOUR_PRIOR)', () => {
    const posteriors = initHourPosteriors();
    expect(getBestHour(posteriors)).toBe(8);
  });

  it('after 20 opens in hour 14, returns 14', () => {
    const hour = initHourPosteriors();
    const day  = initDayPosteriors();
    const events = Array.from({ length: 20 }, () => ({
      hourOfDay: 14,
      dayOfWeek: 1,
      wasOpened: true,
    }));
    const { hourPosteriors } = applyEngagementEvents(hour, day, events);
    expect(getBestHour(hourPosteriors)).toBe(14);
  });

  it('tie-break: lower hour wins when means are equal', () => {
    // Build two hours with identical posteriorMean
    const posteriors: Record<number, BetaDistribution> = {};
    for (let h = 0; h < 24; h++) {
      posteriors[h] = { alpha: 1, beta: 1, posteriorMean: 0.5, sampleSize: 1 };
    }
    expect(getBestHour(posteriors)).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// getBestDay
// ---------------------------------------------------------------------------

describe('getBestDay', () => {
  it('with default prior returns day 2 (Wednesday, highest DAY_PRIOR)', () => {
    const posteriors = initDayPosteriors();
    expect(getBestDay(posteriors)).toBe(2);
  });

  it('tie-break: lower day (Monday) wins when means are equal', () => {
    const posteriors: Record<number, BetaDistribution> = {};
    for (let d = 0; d < 7; d++) {
      posteriors[d] = { alpha: 2, beta: 2, posteriorMean: 0.5, sampleSize: 2 };
    }
    expect(getBestDay(posteriors)).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// normalizeToDistribution
// ---------------------------------------------------------------------------

describe('normalizeToDistribution', () => {
  it('sum of all values equals 1.0 (tolerance 1e-10)', () => {
    const posteriors = initHourPosteriors();
    const dist = normalizeToDistribution(posteriors);
    const sum = Object.values(dist).reduce((a, b) => a + b, 0);
    expect(Math.abs(sum - 1.0)).toBeLessThan(1e-10);
  });

  it('all values are >= 0', () => {
    const posteriors = initHourPosteriors();
    const dist = normalizeToDistribution(posteriors);
    for (const v of Object.values(dist)) {
      expect(v).toBeGreaterThanOrEqual(0);
    }
  });

  it('relative order is preserved: hour with higher posteriorMean has higher probability', () => {
    const hour = initHourPosteriors();
    const day  = initDayPosteriors();
    const events = Array.from({ length: 10 }, () => ({
      hourOfDay: 8,
      dayOfWeek: 1,
      wasOpened: true,
    }));
    const { hourPosteriors } = applyEngagementEvents(hour, day, events);
    const dist = normalizeToDistribution(hourPosteriors);

    // Hour 8 should dominate hour 2 (deep night)
    expect(dist[8]).toBeGreaterThan(dist[2]);
  });

  it('handles degenerate case of zero-total gracefully (uniform distribution)', () => {
    const posteriors: Record<number, BetaDistribution> = {
      0: { alpha: 0, beta: 0, posteriorMean: 0, sampleSize: 0 },
      1: { alpha: 0, beta: 0, posteriorMean: 0, sampleSize: 0 },
    };
    const dist = normalizeToDistribution(posteriors);
    expect(dist[0]).toBeCloseTo(0.5, 10);
    expect(dist[1]).toBeCloseTo(0.5, 10);
  });
});

// ---------------------------------------------------------------------------
// calculateConfidence
// ---------------------------------------------------------------------------

describe('calculateConfidence', () => {
  it('0 interactions → confidence = 0', () => {
    expect(calculateConfidence(0)).toBe(0);
  });

  it('5 interactions → confidence < 0.3', () => {
    expect(calculateConfidence(5)).toBeLessThan(0.3);
  });

  it('20 interactions → confidence ≈ 0.5', () => {
    expect(calculateConfidence(20)).toBeCloseTo(0.5, 5);
  });

  it('100 interactions → confidence > 0.8', () => {
    expect(calculateConfidence(100)).toBeGreaterThan(0.8);
  });

  it('is monotonically increasing', () => {
    let prev = calculateConfidence(0);
    for (let n = 1; n <= 200; n += 5) {
      const curr = calculateConfidence(n);
      expect(curr).toBeGreaterThanOrEqual(prev);
      prev = curr;
    }
  });

  it('never exceeds 1', () => {
    expect(calculateConfidence(1_000_000)).toBeLessThanOrEqual(1);
  });

  it('never goes below 0', () => {
    expect(calculateConfidence(0)).toBeGreaterThanOrEqual(0);
  });
});

// ---------------------------------------------------------------------------
// isCohortFallback
// ---------------------------------------------------------------------------

describe('isCohortFallback', () => {
  it('0 interactions → true', () => {
    expect(isCohortFallback(0)).toBe(true);
  });

  it('4 interactions → true', () => {
    expect(isCohortFallback(4)).toBe(true);
  });

  it('COLD_START_THRESHOLD - 1 → true', () => {
    expect(isCohortFallback(COLD_START_THRESHOLD - 1)).toBe(true);
  });

  it('COLD_START_THRESHOLD (5) interactions → false', () => {
    expect(isCohortFallback(COLD_START_THRESHOLD)).toBe(false);
  });

  it('10 interactions → false', () => {
    expect(isCohortFallback(10)).toBe(false);
  });

  it('100 interactions → false', () => {
    expect(isCohortFallback(100)).toBe(false);
  });
});
