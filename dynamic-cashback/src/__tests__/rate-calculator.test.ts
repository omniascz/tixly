import { describe, it, expect } from 'vitest';
import { computePersonalizedRate } from '../lib/rate-calculator.js';
import {
  DEFAULT_CASHBACK_CONFIG,
  type RfmScore,
} from '../types/dynamic-cashback.js';

const champion: RfmScore = {
  recency: 5,
  frequency: 5,
  monetary: 5,
  cohort: 'champion',
};
const lost: RfmScore = {
  recency: 1,
  frequency: 1,
  monetary: 1,
  cohort: 'lost',
};

describe('rate-calculator: computePersonalizedRate', () => {
  it('bronze + lost = 100 bps', () => {
    const res = computePersonalizedRate(
      'bronze',
      lost,
      [],
      0,
      DEFAULT_CASHBACK_CONFIG,
    );
    expect(res.effectiveRateBps).toBe(100);
    expect(res.components.tierBps).toBe(100);
    expect(res.components.rfmBps).toBe(0);
    expect(res.components.cappedAt).toBeNull();
  });

  it('gold + champion = 900 bps', () => {
    const res = computePersonalizedRate(
      'gold',
      champion,
      [],
      0,
      DEFAULT_CASHBACK_CONFIG,
    );
    expect(res.effectiveRateBps).toBe(900);
    expect(res.components.tierBps).toBe(400);
    expect(res.components.rfmBps).toBe(500);
  });

  it('platinum + champion + 2 big segments caps at 2000 bps', () => {
    const config = {
      ...DEFAULT_CASHBACK_CONFIG,
      segmentBps: { vip: 500, whales: 500 },
    };
    const res = computePersonalizedRate(
      'platinum',
      champion,
      ['vip', 'whales'],
      500,
      config,
    );
    // raw = 800 + 500 + (500+500) + 500 = 2300 → capped at 2000
    expect(res.effectiveRateBps).toBe(2000);
    expect(res.components.cappedAt).toBe(2000);
  });

  it('segment stack cap prevents abuse', () => {
    const config = {
      ...DEFAULT_CASHBACK_CONFIG,
      segmentBps: { a: 500, b: 500, c: 500 },
    };
    const res = computePersonalizedRate(
      'bronze',
      lost,
      ['a', 'b', 'c'],
      0,
      config,
    );
    // segmentRaw = 1500 → clipped to 800
    expect(res.components.segmentBps).toBe(800);
  });

  it('reasons array contains all components', () => {
    const res = computePersonalizedRate(
      'silver',
      champion,
      [],
      0,
      DEFAULT_CASHBACK_CONFIG,
    );
    expect(res.reasons.some((r) => r.includes('Tier silver'))).toBe(true);
    expect(res.reasons.some((r) => r.includes('RFM champion'))).toBe(true);
    expect(res.reasons.some((r) => r.includes('Segmenty'))).toBe(true);
    expect(res.reasons.some((r) => r.includes('Event boost'))).toBe(true);
  });

  it('event boost is additive', () => {
    const res = computePersonalizedRate(
      'bronze',
      lost,
      [],
      200,
      DEFAULT_CASHBACK_CONFIG,
    );
    expect(res.effectiveRateBps).toBe(300);
    expect(res.components.eventBoostBps).toBe(200);
  });
});
