import { describe, it, expect } from 'vitest';
import {
  computeRecommendedPrice,
  computeEarlyBird,
  computeDemandCurve,
  computeTimeDecay,
  computeSurge,
} from '../lib/price-engine.js';
import type { DemandSignals, PricingRule } from '../types/pricing.js';
import { DEFAULT_PRICING_RULE } from '../types/pricing.js';

// ─── Helper: base signals ────────────────────────────────────────────────────

function makeSignals(overrides: Partial<DemandSignals> = {}): DemandSignals {
  return {
    eventId: 'evt-1',
    ticketTypeId: 'tt-1',
    currentPriceHalire: 50000, // 500 Kč
    basePriceHalire: 50000,
    soldCount: 50,
    totalCapacity: 500,
    soldPercentage: 10,
    salesLast1h: 2,
    salesLast24h: 15,
    salesLast7d: 80,
    avgDailySales7d: 80 / 7,
    daysUntilEvent: 45,
    hoursUntilEvent: 45 * 24,
    competitorPriceHalire: null,
    weatherForecast: null,
    dayOfWeek: 3,
    isWeekend: false,
    ...overrides,
  };
}

function makeRule(overrides: Partial<PricingRule> = {}): PricingRule {
  return { ...DEFAULT_PRICING_RULE, ...overrides };
}

// ─── Test 1: Early bird price ────────────────────────────────────────────────

describe('computeEarlyBird', () => {
  it('aplikuje early bird slevu pokud je prodáno méně než práh', () => {
    const signals = makeSignals({ soldPercentage: 10, basePriceHalire: 100000 });
    const rule = makeRule({
      earlyBirdDiscountPct: 15,
      earlyBirdThresholdPct: 20,
    });

    const result = computeEarlyBird(signals, rule);
    // 100000 * (1 - 0.15) = 85000
    expect(result.price).toBe(85000);
    expect(result.reason).toContain('Early bird');
  });

  it('neaplikuje slevu pokud je prodáno více než práh', () => {
    const signals = makeSignals({ soldPercentage: 25, basePriceHalire: 100000 });
    const rule = makeRule({
      earlyBirdDiscountPct: 15,
      earlyBirdThresholdPct: 20,
    });

    const result = computeEarlyBird(signals, rule);
    expect(result.price).toBe(100000);
    expect(result.reason).toBeNull();
  });
});

// ─── Test 2: Demand curve interpolation ──────────────────────────────────────

describe('computeDemandCurve', () => {
  it('interpoluje lineárně mezi min a max cenou dle prodanosti', () => {
    const signals = makeSignals({ soldPercentage: 50 });
    const rule = makeRule({
      minPriceHalire: 10000,
      maxPriceHalire: 90000,
    });

    const result = computeDemandCurve(signals, rule);
    // 10000 + 0.5 * (90000 - 10000) = 10000 + 40000 = 50000
    expect(result.price).toBe(50000);
  });

  it('vrátí minPrice při 0% prodanosti', () => {
    const signals = makeSignals({ soldPercentage: 0 });
    const rule = makeRule({
      minPriceHalire: 20000,
      maxPriceHalire: 80000,
    });

    const result = computeDemandCurve(signals, rule);
    expect(result.price).toBe(20000);
  });

  it('vrátí maxPrice při 100% prodanosti', () => {
    const signals = makeSignals({ soldPercentage: 100 });
    const rule = makeRule({
      minPriceHalire: 20000,
      maxPriceHalire: 80000,
    });

    const result = computeDemandCurve(signals, rule);
    expect(result.price).toBe(80000);
  });
});

// ─── Test 3: Time decay ──────────────────────────────────────────────────────

describe('computeTimeDecay', () => {
  it('zvyšuje cenu jak se blíží datum eventu', () => {
    const signals = makeSignals({
      daysUntilEvent: 15,
      basePriceHalire: 100000,
    });
    const rule = makeRule({
      timeDecayStartDays: 30,
      timeDecayMaxIncreasePct: 40,
    });

    const result = computeTimeDecay(signals, rule);
    // progress = 1 - 15/30 = 0.5, multiplier = 1 + 0.4 * 0.5 = 1.2
    // 100000 * 1.2 = 120000
    expect(result.price).toBe(120000);
    expect(result.reason).toContain('Časový nárůst');
  });

  it('nezvyšuje cenu pokud je do eventu daleko', () => {
    const signals = makeSignals({
      daysUntilEvent: 60,
      basePriceHalire: 100000,
    });
    const rule = makeRule({ timeDecayStartDays: 30 });

    const result = computeTimeDecay(signals, rule);
    expect(result.price).toBe(100000);
    expect(result.reason).toBeNull();
  });
});

// ─── Test 4: Surge ───────────────────────────────────────────────────────────

describe('computeSurge', () => {
  it('aplikuje surge násobek při vysoké rychlosti prodeje', () => {
    const signals = makeSignals({
      salesLast1h: 15,
      currentPriceHalire: 50000,
    });
    const rule = makeRule({
      surgeMultiplier: 1.3,
      surgeVelocityThreshold: 10,
    });

    const result = computeSurge(signals, rule);
    // 50000 * 1.3 = 65000
    expect(result.price).toBe(65000);
    expect(result.reason).toContain('Surge');
  });

  it('neaplikuje surge pod prahem', () => {
    const signals = makeSignals({ salesLast1h: 5 });
    const rule = makeRule({ surgeVelocityThreshold: 10 });

    const result = computeSurge(signals, rule);
    expect(result.price).toBe(signals.currentPriceHalire);
    expect(result.reason).toBeNull();
  });
});

// ─── Test 5: Combined strategy picks max ─────────────────────────────────────

describe('computeRecommendedPrice — combined (demand_curve)', () => {
  it('vybere nejvyšší cenový signál', () => {
    // Setup: surge gives highest price
    const signals = makeSignals({
      soldPercentage: 30, // past early bird threshold
      salesLast1h: 20,    // triggers surge
      currentPriceHalire: 50000,
      basePriceHalire: 50000,
      daysUntilEvent: 10,
    });
    const rule = makeRule({
      strategy: 'demand_curve',
      minPriceHalire: 30000,
      maxPriceHalire: 100000,
      surgeMultiplier: 1.5,
      surgeVelocityThreshold: 10,
      timeDecayStartDays: 30,
      timeDecayMaxIncreasePct: 40,
    });

    const result = computeRecommendedPrice(signals, rule);

    // Surge: 50000 * 1.5 = 75000
    // Time decay: 50000 * (1 + 0.4 * (1 - 10/30)) = 50000 * 1.267 = 63333
    // Demand curve: 30000 + 0.3 * 70000 = 51000
    // Max should be surge = 75000
    expect(result.recommendedPriceHalire).toBe(75000);
    expect(result.strategy).toBe('surge');
  });
});

// ─── Test 6: Clamp to min/max ────────────────────────────────────────────────

describe('computeRecommendedPrice — clamping', () => {
  it('nepřekročí maxPriceHalire', () => {
    const signals = makeSignals({
      salesLast1h: 50,
      currentPriceHalire: 90000,
    });
    const rule = makeRule({
      strategy: 'surge',
      surgeMultiplier: 2.0,
      surgeVelocityThreshold: 5,
      maxPriceHalire: 100000,
    });

    const result = computeRecommendedPrice(signals, rule);
    // 90000 * 2 = 180000 → capped at 100000
    expect(result.recommendedPriceHalire).toBe(100000);
  });

  it('neklesne pod minPriceHalire', () => {
    const signals = makeSignals({
      soldPercentage: 5,
      basePriceHalire: 10000,
    });
    const rule = makeRule({
      strategy: 'early_bird',
      earlyBirdDiscountPct: 50,
      earlyBirdThresholdPct: 10,
      minPriceHalire: 8000,
    });

    const result = computeRecommendedPrice(signals, rule);
    // 10000 * 0.5 = 5000 → clamped at 8000
    expect(result.recommendedPriceHalire).toBe(8000);
  });
});

// ─── Test 7: Auto-adjust threshold ──────────────────────────────────────────

describe('computeRecommendedPrice — shouldAutoApply', () => {
  it('shouldAutoApply je true pokud delta < 15% a confidence > 70', () => {
    const signals = makeSignals({
      soldPercentage: 30,
      salesLast7d: 50,
      salesLast24h: 10,
      salesLast1h: 3,
      currentPriceHalire: 50000,
      basePriceHalire: 50000,
      daysUntilEvent: 20,
    });
    const rule = makeRule({
      strategy: 'time_decay',
      timeDecayStartDays: 30,
      timeDecayMaxIncreasePct: 10, // small increase
    });

    const result = computeRecommendedPrice(signals, rule);
    // progress = 1 - 20/30 = 0.333, increase = 10% * 0.333 = 3.33%
    // This is < 15% delta, and with good data confidence should be > 70
    expect(result.deltaPct).toBeLessThan(15);
    expect(result.confidence).toBeGreaterThan(70);
    expect(result.shouldAutoApply).toBe(true);
  });

  it('shouldAutoApply je false pokud delta >= 15%', () => {
    const signals = makeSignals({
      salesLast1h: 30,
      currentPriceHalire: 50000,
    });
    const rule = makeRule({
      strategy: 'surge',
      surgeMultiplier: 1.5,
      surgeVelocityThreshold: 5,
      maxPriceHalire: 200000,
    });

    const result = computeRecommendedPrice(signals, rule);
    // 50000 * 1.5 = 75000, delta = 50% → should NOT auto-apply
    expect(Math.abs(result.deltaPct)).toBeGreaterThanOrEqual(15);
    expect(result.shouldAutoApply).toBe(false);
  });
});

// ─── Test 8: Integer math ────────────────────────────────────────────────────

describe('computeRecommendedPrice — integer aritmetika', () => {
  it('vždy vrací celé číslo v haléřích', () => {
    const signals = makeSignals({
      soldPercentage: 33.33,
      basePriceHalire: 33333,
      currentPriceHalire: 33333,
    });
    const rule = makeRule({
      strategy: 'early_bird',
      earlyBirdDiscountPct: 7,
      earlyBirdThresholdPct: 50,
    });

    const result = computeRecommendedPrice(signals, rule);
    // 33333 * 0.93 = 30999.69 → should round to 31000
    expect(Number.isInteger(result.recommendedPriceHalire)).toBe(true);
    expect(Number.isInteger(result.deltaHalire)).toBe(true);
  });

  it('cena je vždy kladná nebo nulová', () => {
    const signals = makeSignals({
      soldPercentage: 0,
      basePriceHalire: 100,
    });
    const rule = makeRule({
      strategy: 'early_bird',
      earlyBirdDiscountPct: 99,
      earlyBirdThresholdPct: 5,
      minPriceHalire: 0,
    });

    const result = computeRecommendedPrice(signals, rule);
    expect(result.recommendedPriceHalire).toBeGreaterThanOrEqual(0);
  });
});
