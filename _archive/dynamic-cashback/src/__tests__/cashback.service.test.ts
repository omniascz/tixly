import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  applyCashback,
  getPersonalizedRate,
} from '../services/cashback.service.js';
import { CashbackError } from '../lib/cashback-errors.js';
import type { ServiceDeps } from '../lib/service-container.js';

// Typed helper mock for db
interface MockDb {
  query: ReturnType<typeof vi.fn>;
  execute: ReturnType<typeof vi.fn>;
  transaction: (fn: (tx: MockDb) => Promise<unknown>) => Promise<unknown>;
}

function createMockDeps(): { deps: ServiceDeps; db: MockDb } {
  const db: MockDb = {
    query: vi.fn(),
    execute: vi.fn().mockResolvedValue(undefined),
    transaction: async (fn) => fn(db),
  };
  const kafka = { send: vi.fn().mockResolvedValue(undefined) };
  return { deps: { db, kafka } as unknown as ServiceDeps, db };
}

/**
 * Prime mock db pro "kompletní cestu" getPersonalizedRate:
 *  - rate_cache MISS
 *  - promoter_config MISS (→ default)
 *  - loyalty.accounts → gold tier
 *  - orders aggregate
 *  - segment_members empty
 *  - INSERT do rate_cache
 */
function primeGetRateQueries(db: MockDb): void {
  db.query.mockReset();
  db.query
    .mockResolvedValueOnce([]) // rate_cache miss
    .mockResolvedValueOnce([]) // promoter_config miss
    .mockResolvedValueOnce([{ tier: 'gold', lifetime_points: 500 }]) // loyalty
    .mockResolvedValueOnce([
      {
        last_order_at: new Date(Date.now() - 5 * 86400_000),
        order_count: 12,
        total_spend_halire: 1_500_000,
      },
    ]) // orders → R5, F5, M5 = champion
    .mockResolvedValueOnce([]); // segment memberships
}

describe('cashback.service', () => {
  let ctx: ReturnType<typeof createMockDeps>;
  beforeEach(() => {
    ctx = createMockDeps();
  });

  it('getPersonalizedRate computes and caches rate', async () => {
    primeGetRateQueries(ctx.db);
    const rate = await getPersonalizedRate(
      '11111111-1111-1111-1111-111111111111',
      '22222222-2222-2222-2222-222222222222',
      undefined,
      ctx.deps,
    );
    // gold 400 + champion 500 = 900
    expect(rate.effectiveRateBps).toBe(900);
    expect(ctx.db.execute).toHaveBeenCalled(); // cache write
  });

  it('getPersonalizedRate cache hit skips order DB query', async () => {
    const cached = {
      user_id: 'u1',
      promoter_id: 'p1',
      effective_rate_bps: 700,
      components: { tierBps: 200, rfmBps: 500, segmentBps: 0, eventBoostBps: 0, cappedAt: null },
      reasons: ['cached'],
      computed_at: new Date(),
      valid_until: new Date(Date.now() + 3600_000),
    };
    ctx.db.query.mockReset();
    ctx.db.query.mockResolvedValueOnce([cached]);

    const rate = await getPersonalizedRate('u1', 'p1', undefined, ctx.deps);
    expect(rate.effectiveRateBps).toBe(700);
    // Pouze jediný query call → žádný lookup na orders
    expect(ctx.db.query).toHaveBeenCalledTimes(1);
  });

  it('applyCashback happy path: inserts ledger, updates balance', async () => {
    primeGetRateQueries(ctx.db);
    // Po getPersonalizedRate následuje transaction:
    //   1) SELECT existing ledger → []
    //   2) INSERT RETURNING id
    //   pak execute pro balances
    ctx.db.query
      .mockResolvedValueOnce([]) // existing ledger
      .mockResolvedValueOnce([{ id: 'ledger-1' }]); // insert

    const result = await applyCashback(
      {
        userId: '11111111-1111-1111-1111-111111111111',
        promoterId: '22222222-2222-2222-2222-222222222222',
        orderId: 'ord-1',
        orderAmountHalire: 100_000, // 1000 Kč
      },
      ctx.deps,
    );

    // rate 900 bps × 100000 / 10000 = 9000 halire (integer math)
    expect(result.cashbackHalire).toBe(9000);
    expect(result.ledgerEntryId).toBe('ledger-1');
    expect(result.rate.effectiveRateBps).toBe(900);
  });

  it('applyCashback uses floor() for integer math', async () => {
    primeGetRateQueries(ctx.db);
    ctx.db.query
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{ id: 'ledger-2' }]);
    const result = await applyCashback(
      {
        userId: '11111111-1111-1111-1111-111111111111',
        promoterId: '22222222-2222-2222-2222-222222222222',
        orderId: 'ord-2',
        orderAmountHalire: 12345, // × 900 / 10000 = 1111.05 → 1111
      },
      ctx.deps,
    );
    expect(result.cashbackHalire).toBe(1111);
    expect(Number.isInteger(result.cashbackHalire)).toBe(true);
  });

  it('duplicate orderId throws LEDGER_DUPLICATE', async () => {
    primeGetRateQueries(ctx.db);
    ctx.db.query.mockResolvedValueOnce([{ id: 'existing-ledger' }]);

    await expect(
      applyCashback(
        {
          userId: '11111111-1111-1111-1111-111111111111',
          promoterId: '22222222-2222-2222-2222-222222222222',
          orderId: 'ord-dup',
          orderAmountHalire: 100_000,
        },
        ctx.deps,
      ),
    ).rejects.toBeInstanceOf(CashbackError);
  });

  it('applyCashback rejects non-positive order amount', async () => {
    await expect(
      applyCashback(
        {
          userId: 'u1',
          promoterId: 'p1',
          orderId: 'ord-x',
          orderAmountHalire: 0,
        },
        ctx.deps,
      ),
    ).rejects.toBeInstanceOf(CashbackError);
  });

  it('expired cache triggers re-computation', async () => {
    // První call: cache miss (expirované cache řádek není vrácen dotazem
    // protože filtrujeme `valid_until > NOW()`), full path
    primeGetRateQueries(ctx.db);
    await getPersonalizedRate('u1', 'p1', undefined, ctx.deps);

    // Druhý call: opět cache miss (expirovaná) → re-compute
    primeGetRateQueries(ctx.db);
    const rate = await getPersonalizedRate('u1', 'p1', undefined, ctx.deps);
    expect(rate.effectiveRateBps).toBe(900);
    // Potvrdíme, že byly zavolány "všechny" lookupy (5 query volání per compute)
    expect(ctx.db.query).toHaveBeenCalledTimes(5);
  });
});
