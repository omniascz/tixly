import { describe, it, expect } from 'vitest';
import { calculateFee } from '../services/promoter.service.js';
import type { FeeSchedule } from '../types/platform.js';

function makeSchedule(overrides: Partial<FeeSchedule> = {}): FeeSchedule {
  return {
    id: 'fee-1',
    promoterId: 'promoter-1',
    name: 'default',
    percentageFee: 500,   // 5%
    fixedFee: 0,
    minFee: null,
    maxFee: null,
    validFrom: new Date().toISOString(),
    validUntil: null,
    isActive: true,
    ...overrides,
  };
}

describe('calculateFee', () => {
  it('basic 5% fee: 10000 haléřů (100 Kč) → 500 haléřů (5 Kč)', () => {
    const schedule = makeSchedule({ percentageFee: 500, fixedFee: 0 });
    expect(calculateFee(10000, schedule)).toBe(500);
  });

  it('fixed fee only: 0% + 1500 haléřů fixní → fee = 1500', () => {
    const schedule = makeSchedule({ percentageFee: 0, fixedFee: 1500 });
    expect(calculateFee(10000, schedule)).toBe(1500);
  });

  it('combined: 5% + 500 haléřů fixní na 10000 haléřích', () => {
    const schedule = makeSchedule({ percentageFee: 500, fixedFee: 500 });
    // 10000 * 500 / 10000 = 500, + 500 fixní = 1000
    expect(calculateFee(10000, schedule)).toBe(1000);
  });

  it('min fee applied when calculated result is lower', () => {
    const schedule = makeSchedule({ percentageFee: 100, fixedFee: 0, minFee: 300 });
    // 10000 * 100 / 10000 = 100, ale min je 300
    expect(calculateFee(10000, schedule)).toBe(300);
  });

  it('max fee applied when calculated result is higher', () => {
    const schedule = makeSchedule({ percentageFee: 1000, fixedFee: 0, maxFee: 500 });
    // 10000 * 1000 / 10000 = 1000, ale max je 500
    expect(calculateFee(10000, schedule)).toBe(500);
  });

  it('zero ticket price returns zero fee (or min if set)', () => {
    const schedule = makeSchedule({ percentageFee: 500, fixedFee: 0 });
    expect(calculateFee(0, schedule)).toBe(0);
  });

  it('zero ticket price with min fee returns min fee', () => {
    const schedule = makeSchedule({ percentageFee: 500, fixedFee: 0, minFee: 200 });
    expect(calculateFee(0, schedule)).toBe(200);
  });

  it('result is always INTEGER — no float', () => {
    // 3333 haléřů * 500 / 10000 = 166.65 → Math.round = 167
    const schedule = makeSchedule({ percentageFee: 500, fixedFee: 0 });
    const result = calculateFee(3333, schedule);
    expect(Number.isInteger(result)).toBe(true);
    expect(result).toBe(167);
  });

  it('min and max both null: no clamping applied', () => {
    const schedule = makeSchedule({ percentageFee: 500, fixedFee: 0, minFee: null, maxFee: null });
    expect(calculateFee(20000, schedule)).toBe(1000);
  });
});
