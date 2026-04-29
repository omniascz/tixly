import { describe, it, expect } from 'vitest';
import {
  calculateDemandFactor,
  calculateFinalPrice,
  resolveActivePhase,
  getNextPhase,
} from './pricing-calculator';
import type { PricingRule } from '../types/pricing';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function makeRule(overrides: Partial<PricingRule> = {}): PricingRule {
  return {
    id: 'rule-1',
    ticketTypeId: 'tt-1',
    phase: 'regular',
    price: 400,
    thresholdQty: null,
    thresholdDate: null,
    demandFactorMin: 1.0,
    demandFactorMax: 1.5,
    priority: 10,
    active: true,
    ...overrides,
  };
}

const NOW = new Date('2026-04-03T12:00:00Z');
const PAST = new Date('2026-04-01T00:00:00Z');
const FUTURE = new Date('2026-04-10T00:00:00Z');

// ---------------------------------------------------------------------------
// calculateDemandFactor
// ---------------------------------------------------------------------------

describe('calculateDemandFactor', () => {
  it('returns demandFactorMin when 0% sold', () => {
    const rule = makeRule({ demandFactorMin: 1.0, demandFactorMax: 1.5 });
    expect(calculateDemandFactor(0, 100, rule)).toBe(1.0);
  });

  it('returns midpoint at 50% sold', () => {
    const rule = makeRule({ demandFactorMin: 1.0, demandFactorMax: 1.5 });
    expect(calculateDemandFactor(50, 100, rule)).toBe(1.25);
  });

  it('returns demandFactorMax at 100% sold', () => {
    const rule = makeRule({ demandFactorMin: 1.0, demandFactorMax: 1.5 });
    expect(calculateDemandFactor(100, 100, rule)).toBe(1.5);
  });

  it('clamps to demandFactorMin when soldQty is negative', () => {
    const rule = makeRule({ demandFactorMin: 1.0, demandFactorMax: 1.5 });
    expect(calculateDemandFactor(-10, 100, rule)).toBe(1.0);
  });

  it('clamps to demandFactorMax when soldQty exceeds totalQty', () => {
    const rule = makeRule({ demandFactorMin: 1.0, demandFactorMax: 1.5 });
    expect(calculateDemandFactor(150, 100, rule)).toBe(1.5);
  });

  it('returns demandFactorMin when totalQty is 0', () => {
    const rule = makeRule({ demandFactorMin: 1.0, demandFactorMax: 1.5 });
    expect(calculateDemandFactor(0, 0, rule)).toBe(1.0);
  });

  it('rounds to 2 decimal places', () => {
    const rule = makeRule({ demandFactorMin: 1.0, demandFactorMax: 1.5 });
    // 33% sold → 1.0 + 0.5 * 0.333... = 1.1666... → 1.17
    expect(calculateDemandFactor(33, 100, rule)).toBe(1.17);
  });

  it('works with equal min and max (no demand scaling)', () => {
    const rule = makeRule({ demandFactorMin: 1.0, demandFactorMax: 1.0 });
    expect(calculateDemandFactor(75, 100, rule)).toBe(1.0);
  });
});

// ---------------------------------------------------------------------------
// calculateFinalPrice
// ---------------------------------------------------------------------------

describe('calculateFinalPrice', () => {
  it('rounds up to nearest 10 Kč', () => {
    // 40000 hl * 1.1 = 44000.000000000004 (float) → ceil(44000.000000000004/1000)*1000 = 45000 hl = 450 Kč
    expect(calculateFinalPrice(40000, 1.1)).toBe(45000);
  });

  it('rounds up when result is not on 1000 boundary', () => {
    // 43300 hl * 1.0 = 43300 → ceil(43300/1000)*1000 = 44000 hl = 440 Kč
    expect(calculateFinalPrice(43300, 1.0)).toBe(44000);
  });

  it('rounds 43700 hl up to 44000 hl (437 Kč → 440 Kč)', () => {
    // 35000 hl * 1.249 ≈ 43715 → ceil(43715/1000)*1000 = 44000 hl
    expect(calculateFinalPrice(35000, 1.249)).toBe(44000);
  });

  it('returns 0 for 0 price', () => {
    expect(calculateFinalPrice(0, 1.5)).toBe(0);
  });

  it('handles exact multiples of 1000 without changing them', () => {
    expect(calculateFinalPrice(50000, 1.0)).toBe(50000);
  });

  it('handles demand factor of 1.5 correctly', () => {
    // 20000 hl * 1.5 = 30000 hl = 300 Kč
    expect(calculateFinalPrice(20000, 1.5)).toBe(30000);
  });

  it('rounds up even small fractions', () => {
    // 10000 hl * 1.01 = 10100 hl → ceil(10100/1000)*1000 = 11000 hl = 110 Kč
    expect(calculateFinalPrice(10000, 1.01)).toBe(11000);
  });
});

// ---------------------------------------------------------------------------
// resolveActivePhase
// ---------------------------------------------------------------------------

describe('resolveActivePhase', () => {
  it('returns null when no rules provided', () => {
    expect(resolveActivePhase([], 0, 100, NOW)).toBeNull();
  });

  it('returns null when no rule conditions are met', () => {
    const rule = makeRule({
      thresholdDate: FUTURE,
      thresholdQty: 80,
    });
    expect(resolveActivePhase([rule], 10, 100, NOW)).toBeNull();
  });

  it('triggers on date threshold', () => {
    const rule = makeRule({
      phase: 'regular',
      thresholdDate: PAST,
      thresholdQty: null,
      priority: 10,
    });
    const result = resolveActivePhase([rule], 0, 100, NOW);
    expect(result?.phase).toBe('regular');
  });

  it('triggers on qty threshold', () => {
    const rule = makeRule({
      phase: 'late',
      thresholdDate: null,
      thresholdQty: 50,
      priority: 20,
    });
    const result = resolveActivePhase([rule], 60, 100, NOW);
    expect(result?.phase).toBe('late');
  });

  it('does not trigger when qty threshold not yet reached', () => {
    const rule = makeRule({
      thresholdDate: null,
      thresholdQty: 50,
    });
    expect(resolveActivePhase([rule], 40, 100, NOW)).toBeNull();
  });

  it('selects highest priority rule when multiple are triggered', () => {
    const rules: PricingRule[] = [
      makeRule({ id: 'r1', phase: 'early_bird', thresholdDate: PAST, thresholdQty: null, priority: 5 }),
      makeRule({ id: 'r2', phase: 'regular', thresholdDate: PAST, thresholdQty: null, priority: 10 }),
      makeRule({ id: 'r3', phase: 'late', thresholdDate: PAST, thresholdQty: null, priority: 20 }),
    ];
    const result = resolveActivePhase(rules, 0, 100, NOW);
    expect(result?.phase).toBe('late');
    expect(result?.id).toBe('r3');
  });

  it('ignores inactive rules', () => {
    const rules: PricingRule[] = [
      makeRule({ phase: 'regular', thresholdDate: PAST, active: false, priority: 10 }),
      makeRule({ id: 'r2', phase: 'early_bird', thresholdDate: PAST, active: true, priority: 5 }),
    ];
    const result = resolveActivePhase(rules, 0, 100, NOW);
    expect(result?.phase).toBe('early_bird');
  });

  it('triggers on date even if qty not reached', () => {
    const rule = makeRule({
      thresholdDate: PAST,
      thresholdQty: 90,
    });
    // Only 10 sold, qty threshold not met, but date has passed
    const result = resolveActivePhase([rule], 10, 100, NOW);
    expect(result).not.toBeNull();
  });

  it('triggers on qty even if date not reached', () => {
    const rule = makeRule({
      thresholdDate: FUTURE,
      thresholdQty: 10,
    });
    const result = resolveActivePhase([rule], 15, 100, NOW);
    expect(result).not.toBeNull();
  });

  it('returns null for rule with no thresholds at all', () => {
    const rule = makeRule({ thresholdDate: null, thresholdQty: null });
    expect(resolveActivePhase([rule], 50, 100, NOW)).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// getNextPhase
// ---------------------------------------------------------------------------

describe('getNextPhase', () => {
  it('returns null when no pending rules', () => {
    const rule = makeRule({ phase: 'regular', thresholdDate: PAST, priority: 10 });
    // regular is the current phase, and only rule
    expect(getNextPhase([rule], 'regular', 10, 100, NOW)).toBeNull();
  });

  it('returns next phase by date', () => {
    const rules: PricingRule[] = [
      makeRule({ phase: 'regular', thresholdDate: PAST, priority: 10 }),
      makeRule({ id: 'r2', phase: 'late', thresholdDate: FUTURE, thresholdQty: null, priority: 20 }),
    ];
    const next = getNextPhase(rules, 'regular', 10, 100, NOW);
    expect(next?.phase).toBe('late');
    expect(next?.date).toEqual(FUTURE);
  });

  it('returns next phase by qty', () => {
    const rules: PricingRule[] = [
      makeRule({ phase: 'regular', thresholdDate: PAST, priority: 10 }),
      makeRule({ id: 'r2', phase: 'late', thresholdDate: null, thresholdQty: 80, priority: 20 }),
    ];
    const next = getNextPhase(rules, 'regular', 10, 100, NOW);
    expect(next?.phase).toBe('late');
    expect(next?.qty).toBe(80);
  });

  it('excludes already-triggered rules', () => {
    const rules: PricingRule[] = [
      makeRule({ phase: 'early_bird', thresholdDate: PAST, priority: 5 }),
      makeRule({ id: 'r2', phase: 'regular', thresholdDate: PAST, priority: 10 }),
      makeRule({ id: 'r3', phase: 'late', thresholdDate: FUTURE, thresholdQty: null, priority: 20 }),
    ];
    // currently in regular, late is next
    const next = getNextPhase(rules, 'regular', 10, 100, NOW);
    expect(next?.phase).toBe('late');
  });

  it('returns null when all phases have been triggered', () => {
    const rules: PricingRule[] = [
      makeRule({ phase: 'early_bird', thresholdDate: PAST, thresholdQty: null, priority: 5 }),
      makeRule({ id: 'r2', phase: 'regular', thresholdDate: PAST, thresholdQty: null, priority: 10 }),
      makeRule({ id: 'r3', phase: 'late', thresholdDate: PAST, thresholdQty: null, priority: 20 }),
    ];
    const next = getNextPhase(rules, 'late', 80, 100, NOW);
    expect(next).toBeNull();
  });

  it('handles rules with both date and qty thresholds', () => {
    const futureQtyRule = makeRule({
      id: 'r2',
      phase: 'late',
      thresholdDate: FUTURE,
      thresholdQty: 90,
      priority: 20,
    });
    const rules = [
      makeRule({ phase: 'regular', thresholdDate: PAST, priority: 10 }),
      futureQtyRule,
    ];
    const next = getNextPhase(rules, 'regular', 10, 100, NOW);
    expect(next?.phase).toBe('late');
    // Both thresholds should be present since neither has triggered
    expect(next?.date).toEqual(FUTURE);
    expect(next?.qty).toBe(90);
  });

  it('handles empty rules array', () => {
    expect(getNextPhase([], 'early_bird', 0, 100, NOW)).toBeNull();
  });
});
