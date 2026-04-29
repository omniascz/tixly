import { describe, it, expect } from 'vitest';
import {
  attributeCommission,
  splitCommissionByShares,
  type TouchPoint,
} from '../src/lib/attribution-models';

// 3-touch sample: A (den 0), B (den 5), C (den 9). Konverze den 10.
const sample: TouchPoint[] = [
  { affiliateId: 'A', affiliateCode: 'aaaa1111', clickedAt: new Date('2026-04-01T00:00:00Z') },
  { affiliateId: 'B', affiliateCode: 'bbbb2222', clickedAt: new Date('2026-04-06T00:00:00Z') },
  { affiliateId: 'C', affiliateCode: 'cccc3333', clickedAt: new Date('2026-04-10T00:00:00Z') },
];
const orderTime = new Date('2026-04-11T00:00:00Z');

function sumShares(r: Record<string, number>): number {
  return Object.values(r).reduce((a, b) => a + b, 0);
}

describe('attributeCommission()', () => {
  it('last_click → 100 % poslednímu', () => {
    const { shares } = attributeCommission(sample, orderTime, 'last_click');
    expect(shares).toEqual({ C: 1 });
  });

  it('first_click → 100 % prvnímu', () => {
    const { shares } = attributeCommission(sample, orderTime, 'first_click');
    expect(shares).toEqual({ A: 1 });
  });

  it('linear → 1/3 každému', () => {
    const { shares } = attributeCommission(sample, orderTime, 'linear');
    expect(shares.A).toBeCloseTo(1 / 3, 10);
    expect(shares.B).toBeCloseTo(1 / 3, 10);
    expect(shares.C).toBeCloseTo(1 / 3, 10);
    expect(sumShares(shares)).toBeCloseTo(1, 10);
  });

  it('time_decay → novější touchpointy mají vyšší váhu, suma = 1', () => {
    const { shares } = attributeCommission(sample, orderTime, 'time_decay');
    expect(sumShares(shares)).toBeCloseTo(1, 10);
    expect(shares.C).toBeGreaterThan(shares.B);
    expect(shares.B).toBeGreaterThan(shares.A);
  });

  it('position_based → 40 % first, 40 % last, 20 % middle', () => {
    const { shares } = attributeCommission(sample, orderTime, 'position_based');
    expect(shares.A).toBeCloseTo(0.4, 10);
    expect(shares.C).toBeCloseTo(0.4, 10);
    expect(shares.B).toBeCloseTo(0.2, 10);
    expect(sumShares(shares)).toBeCloseTo(1, 10);
  });

  it('prázdný vstup → prázdný výsledek', () => {
    const { shares } = attributeCommission([], orderTime, 'linear');
    expect(shares).toEqual({});
  });

  it('position_based s jedním touchpointem → 100 %', () => {
    const { shares } = attributeCommission([sample[0]], orderTime, 'position_based');
    expect(shares).toEqual({ A: 1 });
  });

  it('position_based se dvěma touchpointy → 50/50', () => {
    const { shares } = attributeCommission(sample.slice(0, 2), orderTime, 'position_based');
    expect(shares.A).toBeCloseTo(0.5, 10);
    expect(shares.B).toBeCloseTo(0.5, 10);
  });

  it('agreguje více touchpointů stejného affiliata', () => {
    const tp: TouchPoint[] = [
      { affiliateId: 'A', affiliateCode: 'x', clickedAt: new Date('2026-04-01T00:00:00Z') },
      { affiliateId: 'A', affiliateCode: 'x', clickedAt: new Date('2026-04-05T00:00:00Z') },
      { affiliateId: 'B', affiliateCode: 'y', clickedAt: new Date('2026-04-06T00:00:00Z') },
    ];
    const { shares } = attributeCommission(tp, orderTime, 'linear');
    expect(shares.A).toBeCloseTo(2 / 3, 10);
    expect(shares.B).toBeCloseTo(1 / 3, 10);
  });
});

describe('splitCommissionByShares()', () => {
  it('zachová celkovou sumu bez ztráty zaokrouhlením', () => {
    const split = splitCommissionByShares(1000, { A: 1 / 3, B: 1 / 3, C: 1 / 3 });
    const sum = Object.values(split).reduce((a, b) => a + b, 0);
    expect(sum).toBe(1000);
  });

  it('přidělí podíly podle shares', () => {
    const split = splitCommissionByShares(10000, { A: 0.4, B: 0.2, C: 0.4 });
    expect(split.A).toBe(4000);
    expect(split.B).toBe(2000);
    expect(split.C).toBe(4000);
  });
});
