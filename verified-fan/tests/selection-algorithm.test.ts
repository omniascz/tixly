import { describe, it, expect } from 'vitest';
import {
  computeFanWeight,
  selectFans,
  type FanWeightInputs,
  type FanWeight,
} from '../src/lib/selection-algorithm';

const PRESALE_OPEN = new Date('2026-05-01T10:00:00Z');

function makeFan(overrides: Partial<FanWeightInputs> = {}): FanWeightInputs {
  return {
    fanId: 'fan_default',
    loyaltyYears: 0,
    pastPurchases: 0,
    identityVerified: false,
    localFan: false,
    socialFollowers: 0,
    registeredAt: new Date('2026-05-10T00:00:00Z'),
    ...overrides,
  };
}

describe('computeFanWeight()', () => {
  it('applies caps on loyalty, purchases and social', () => {
    const w = computeFanWeight(
      makeFan({
        loyaltyYears: 100,
        pastPurchases: 100,
        socialFollowers: 1_000_000,
      }),
      PRESALE_OPEN,
    );
    expect(w.breakdown.loyalty).toBe(50);
    expect(w.breakdown.purchases).toBe(50);
    expect(w.breakdown.social).toBe(20);
  });

  it('loyal + verified + local customer beats a brand-new fan', () => {
    const loyal = computeFanWeight(
      makeFan({
        fanId: 'loyal',
        loyaltyYears: 5,
        pastPurchases: 8,
        identityVerified: true,
        localFan: true,
        socialFollowers: 5000,
      }),
      PRESALE_OPEN,
    );
    const newbie = computeFanWeight(makeFan({ fanId: 'new' }), PRESALE_OPEN);
    expect(loyal.totalScore).toBeGreaterThan(newbie.totalScore);
  });

  it('gives up to +10 for registering right when presale opens', () => {
    const early = computeFanWeight(
      makeFan({ registeredAt: PRESALE_OPEN }),
      PRESALE_OPEN,
    );
    expect(early.breakdown.early).toBeCloseTo(10, 5);
  });

  it('no early bonus after 24h window', () => {
    const late = computeFanWeight(
      makeFan({ registeredAt: new Date(PRESALE_OPEN.getTime() + 48 * 3600 * 1000) }),
      PRESALE_OPEN,
    );
    expect(late.breakdown.early).toBe(0);
  });
});

describe('selectFans()', () => {
  const weights: FanWeight[] = [
    { fanId: 'a', totalScore: 100, breakdown: {} },
    { fanId: 'b', totalScore: 80, breakdown: {} },
    { fanId: 'c', totalScore: 60, breakdown: {} },
    { fanId: 'd', totalScore: 40, breakdown: {} },
  ];

  it('returns exactly N fans sorted descending', () => {
    const picked = selectFans(weights, 2);
    expect(picked).toHaveLength(2);
    expect(picked[0].fanId).toBe('a');
    expect(picked[1].fanId).toBe('b');
  });

  it('returns empty array when targetCount <= 0', () => {
    expect(selectFans(weights, 0)).toEqual([]);
  });

  it('returns all fans when targetCount exceeds pool', () => {
    expect(selectFans(weights, 99)).toHaveLength(4);
  });
});
