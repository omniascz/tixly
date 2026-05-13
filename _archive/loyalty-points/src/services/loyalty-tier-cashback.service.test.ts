// Testy pro cashback + tier recompute rozšíření.

import { describe, it, expect, vi } from 'vitest';
import {
  redeemPointsForCashback,
  recomputeTiers,
  getPromoterLoyaltyConfig,
  DEFAULT_PROMOTER_CONFIG,
} from './loyalty-tier-cashback.service.js';
import { InsufficientPointsError, InvalidRedemptionError } from '../types/loyalty.types.js';
import { calculateEarnedPoints, getTier } from '../lib/points-calculator.js';

// ---------------------------------------------------------------------------
// Stub deps helper
// ---------------------------------------------------------------------------

function makeDeps(overrides: {
  queryResults?: unknown[][];
  executeSpy?: ReturnType<typeof vi.fn>;
} = {}) {
  const results = [...(overrides.queryResults ?? [])];
  const execute = overrides.executeSpy ?? vi.fn().mockResolvedValue(undefined);
  const kafkaSend = vi.fn().mockResolvedValue(undefined);

  const tx = {
    query: vi.fn().mockImplementation(() => Promise.resolve(results.shift() ?? [])),
    execute,
  };

  const db = {
    query: vi.fn().mockImplementation(() => Promise.resolve(results.shift() ?? [])),
    execute,
    transaction: vi.fn().mockImplementation(async (fn: (tx: typeof tx) => unknown) => fn(tx)),
  };

  return { deps: { db, kafka: { send: kafkaSend } } as any, kafkaSend, execute };
}

// Mock withTenantContext na passthrough
vi.mock('@tixly/rls-multitenancy', () => ({
  withTenantContext: async (
    db: unknown,
    _ctx: unknown,
    fn: (db: unknown) => unknown,
  ) => fn(db),
}));

// ---------------------------------------------------------------------------
// pure calculators
// ---------------------------------------------------------------------------

describe('points-calculator tier multipliers', () => {
  it('gold multiplier applies correctly', () => {
    expect(calculateEarnedPoints(100_00, 'gold')).toBe(200); // 100 Kč × 2
  });

  it('silver multiplier', () => {
    expect(calculateEarnedPoints(100_00, 'silver')).toBe(150);
  });

  it('bronze multiplier is identity', () => {
    expect(calculateEarnedPoints(100_00, 'bronze')).toBe(100);
  });

  it('zero or negative order → 0', () => {
    expect(calculateEarnedPoints(0, 'gold')).toBe(0);
    expect(calculateEarnedPoints(-500, 'gold')).toBe(0);
  });
});

describe('getTier', () => {
  it('returns bronze under threshold', () => {
    expect(getTier(0)).toBe('bronze');
    expect(getTier(4_999)).toBe('bronze');
  });
  it('transitions silver → gold → platinum', () => {
    expect(getTier(5_000)).toBe('silver');
    expect(getTier(20_000)).toBe('gold');
    expect(getTier(50_000)).toBe('platinum');
  });
});

// ---------------------------------------------------------------------------
// redeemPointsForCashback
// ---------------------------------------------------------------------------

describe('redeemPointsForCashback', () => {
  it('throws on non-positive points', async () => {
    const { deps } = makeDeps();
    await expect(
      redeemPointsForCashback(deps, 'u1', 0, 'o1', 10_000, 'p1'),
    ).rejects.toBeInstanceOf(InvalidRedemptionError);
  });

  it('rejects cashback > 50% of order', async () => {
    const { deps } = makeDeps({
      queryResults: [[]], // promoter config lookup → empty → defaults
    });
    await expect(
      redeemPointsForCashback(deps, 'u1', 6_000, 'o1', 10_000, 'p1'),
    ).rejects.toBeInstanceOf(InvalidRedemptionError);
  });

  it('rejects on insufficient balance', async () => {
    const { deps } = makeDeps({
      queryResults: [
        [], // config
        [{ total_points: 100 }], // account
      ],
    });
    await expect(
      redeemPointsForCashback(deps, 'u1', 500, 'o1', 10_000, 'p1'),
    ).rejects.toBeInstanceOf(InsufficientPointsError);
  });

  it('succeeds under cap and sufficient balance', async () => {
    const { deps, kafkaSend, execute } = makeDeps({
      queryResults: [
        [], // config lookup
        [{ total_points: 2_000 }], // account
      ],
    });
    const res = await redeemPointsForCashback(deps, 'u1', 500, 'o1', 10_000, 'p1');
    expect(res).toEqual({ discountHalire: 500, remainingBalance: 1_500 });
    expect(execute).toHaveBeenCalled();
    expect(kafkaSend).toHaveBeenCalledWith(
      'loyalty.points_redeemed',
      expect.objectContaining({ option: 'cashback', discountHalire: 500 }),
    );
  });
});

// ---------------------------------------------------------------------------
// recomputeTiers
// ---------------------------------------------------------------------------

describe('recomputeTiers', () => {
  it('demotes gold → bronze when 90d earn too low', async () => {
    const { deps, kafkaSend, execute } = makeDeps({
      queryResults: [
        [
          { user_id: 'u1', tier: 'gold', recent_points: 100 },
          { user_id: 'u2', tier: 'silver', recent_points: 10_000 }, // no change (still silver via threshold 5k; gold is 20k)
          { user_id: 'u3', tier: 'bronze', recent_points: 0 }, // no change
        ],
      ],
    });

    const res = await recomputeTiers(deps);
    expect(res.scanned).toBe(3);
    expect(res.demoted).toBe(1);
    expect(execute).toHaveBeenCalledWith(
      expect.stringContaining('UPDATE loyalty.accounts'),
      ['bronze', 'u1'],
    );
    expect(kafkaSend).toHaveBeenCalledWith(
      'loyalty.tier.changed',
      expect.objectContaining({ userId: 'u1', previousTier: 'gold', newTier: 'bronze' }),
    );
  });

  it('never upgrades (upgrade is earnPoints job)', async () => {
    const { deps, execute } = makeDeps({
      queryResults: [[{ user_id: 'u1', tier: 'bronze', recent_points: 30_000 }]],
    });
    const res = await recomputeTiers(deps);
    expect(res.demoted).toBe(0);
    expect(execute).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// getPromoterLoyaltyConfig
// ---------------------------------------------------------------------------

describe('getPromoterLoyaltyConfig', () => {
  it('returns defaults when no row exists', async () => {
    const { deps } = makeDeps({ queryResults: [[]] });
    const cfg = await getPromoterLoyaltyConfig(deps, 'p1');
    expect(cfg.promoterId).toBe('p1');
    expect(cfg.cashbackCapPct).toBe(DEFAULT_PROMOTER_CONFIG.cashbackCapPct);
  });

  it('parses JSONB columns', async () => {
    const { deps } = makeDeps({
      queryResults: [
        [
          {
            promoter_id: 'p1',
            tier_thresholds: '{"bronze":0,"silver":2000,"gold":8000,"platinum":20000}',
            tier_multipliers: '{"bronze":1,"silver":1.3,"gold":1.8,"platinum":2.5}',
            base_earn_rate: '1.2',
            cashback_cap_pct: '0.4',
            cashback_conversion_halire_per_point: '2',
          },
        ],
      ],
    });
    const cfg = await getPromoterLoyaltyConfig(deps, 'p1');
    expect(cfg.tierThresholds.silver).toBe(2000);
    expect(cfg.tierMultipliers.gold).toBe(1.8);
    expect(cfg.cashbackCapPct).toBe(0.4);
    expect(cfg.cashbackConversionHalirePerPoint).toBe(2);
  });
});
