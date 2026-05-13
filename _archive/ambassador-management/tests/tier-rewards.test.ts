import { describe, it, expect } from 'vitest';
import {
  computeTier,
  computeReward,
  checkMilestones,
  DEFAULT_TIERS,
  DEFAULT_MILESTONES,
} from '../src/lib/tier-rewards.js';

describe('computeTier', () => {
  it('returns starter for 0 conversions', () => {
    expect(computeTier(0).tier).toBe('starter');
  });

  it('stays starter at 24 conversions (boundary - 1)', () => {
    expect(computeTier(24).tier).toBe('starter');
  });

  it('transitions to influencer exactly at 25 conversions', () => {
    expect(computeTier(25).tier).toBe('influencer');
  });

  it('stays influencer at 99 conversions', () => {
    expect(computeTier(99).tier).toBe('influencer');
  });

  it('transitions to star exactly at 100 conversions', () => {
    expect(computeTier(100).tier).toBe('star');
  });

  it('remains star well beyond 100', () => {
    expect(computeTier(10_000).tier).toBe('star');
  });

  it('rejects negative counts', () => {
    expect(() => computeTier(-1)).toThrow(RangeError);
  });

  it('rejects non-integer counts', () => {
    expect(() => computeTier(3.5)).toThrow(RangeError);
  });
});

describe('computeReward', () => {
  const starter = DEFAULT_TIERS[0];
  const influencer = DEFAULT_TIERS[1];
  const star = DEFAULT_TIERS[2];

  it('starter: 5 % of 1000 Kč (100 000 haléřů) = 5000 haléřů, no flat bonus', () => {
    const r = computeReward(100_000, starter);
    expect(r.commissionHalire).toBe(5_000);
    expect(r.flatBonusHalire).toBe(0);
    expect(r.totalHalire).toBe(5_000);
  });

  it('influencer: 10 % of 100 000 + 5000 flat bonus', () => {
    const r = computeReward(100_000, influencer);
    expect(r.commissionHalire).toBe(10_000);
    expect(r.flatBonusHalire).toBe(5_000);
    expect(r.totalHalire).toBe(15_000);
  });

  it('star: 15 % of 100 000 + 10 000 flat bonus', () => {
    const r = computeReward(100_000, star);
    expect(r.commissionHalire).toBe(15_000);
    expect(r.flatBonusHalire).toBe(10_000);
    expect(r.totalHalire).toBe(25_000);
  });

  it('floors fractional haléře', () => {
    // 12345 * 500 / 10000 = 617.25 → 617
    const r = computeReward(12_345, starter);
    expect(r.commissionHalire).toBe(617);
  });

  it('rejects negative order amount', () => {
    expect(() => computeReward(-1, starter)).toThrow(RangeError);
  });
});

describe('checkMilestones', () => {
  it('triggers 10th conversion milestone when crossing 9 → 10', () => {
    const hit = checkMilestones(9, 10);
    expect(hit).toHaveLength(1);
    expect(hit[0].atConversion).toBe(10);
    expect(hit[0].bonusHalire).toBe(50_000);
  });

  it('returns empty when no milestone crossed (8 → 9)', () => {
    expect(checkMilestones(8, 9)).toEqual([]);
  });

  it('does NOT re-trigger past milestones (11 → 12)', () => {
    expect(checkMilestones(11, 12)).toEqual([]);
  });

  it('triggers two milestones if count jumps from 9 to 50', () => {
    const hit = checkMilestones(9, 50);
    expect(hit.map((m) => m.atConversion)).toEqual([10, 50]);
  });

  it('triggers all three milestones across full range', () => {
    const hit = checkMilestones(0, 100, DEFAULT_MILESTONES);
    expect(hit).toHaveLength(3);
  });

  it('returns empty when newCount <= previousCount', () => {
    expect(checkMilestones(50, 50)).toEqual([]);
    expect(checkMilestones(50, 49)).toEqual([]);
  });
});
