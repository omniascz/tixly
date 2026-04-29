import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { DbAdapter } from '@tixly/db-adapter';
import {
  matchLevel1,
  matchLevel2,
  matchLevel3,
  matchLevel4,
  matchPayment,
  matchAllUnmatched,
  applyMatch,
  getMatchingStats,
  setAiMatchProvider,
  DEFAULT_MATCHING_CONFIG,
  type PaymentInput,
  type MatchCandidate,
} from '../services/payment-matching.js';

/* ---------- Mock DbAdapter ---------- */

function makeMockDb(queryResults: Record<string, any[]> = {}): DbAdapter & { _calls: any[] } {
  const calls: any[] = [];
  let callIndex = 0;

  const db: any = {
    _calls: calls,
    query: vi.fn(async (sql: string, params?: unknown[]) => {
      calls.push({ method: 'query', sql, params });
      // Return results based on call order or SQL pattern
      for (const [pattern, result] of Object.entries(queryResults)) {
        if (sql.includes(pattern)) return result;
      }
      return [];
    }),
    execute: vi.fn(async (sql: string, params?: unknown[]) => {
      calls.push({ method: 'execute', sql, params });
    }),
    transaction: vi.fn(async (fn: (tx: DbAdapter) => Promise<any>) => {
      // Create a transaction mock that shares the same calls array
      const txDb: any = {
        query: vi.fn(async (sql: string, params?: unknown[]) => {
          calls.push({ method: 'tx.query', sql, params });
          return [];
        }),
        execute: vi.fn(async (sql: string, params?: unknown[]) => {
          calls.push({ method: 'tx.execute', sql, params });
        }),
        transaction: vi.fn(),
      };
      return fn(txDb);
    }),
  };

  return db;
}

/* ---------- Test data ---------- */

const ORDER_EXACT = {
  id: 'order-1',
  variable_symbol: '123456',
  total_halire: 150000,
  currency: 'CZK',
  customer_name: 'Jan Novák',
  status: 'awaiting_payment',
};

const ORDER_DIFFERENT_AMOUNT = {
  ...ORDER_EXACT,
  id: 'order-2',
  total_halire: 200000,
};

const PAYMENT_EXACT: PaymentInput = {
  id: 'bp-1',
  amountHalire: 150000,
  currency: 'CZK',
  variableSymbol: '123456',
  receivedAt: new Date('2026-04-12'),
};

/* ================================================================== */
/* Level 1: Exact VS + amount                                         */
/* ================================================================== */

describe('matchLevel1', () => {
  it('returns candidate when VS and amount match exactly', async () => {
    const db = makeMockDb({ 'orders.orders': [ORDER_EXACT] });
    const candidates = await matchLevel1(db, '123456', 150000, 'CZK');

    expect(candidates).toHaveLength(1);
    expect(candidates[0].matchLevel).toBe(1);
    expect(candidates[0].matchScore).toBe(1.0);
    expect(candidates[0].orderId).toBe('order-1');
  });

  it('returns empty when amount differs', async () => {
    const db = makeMockDb({ 'orders.orders': [ORDER_DIFFERENT_AMOUNT] });
    const candidates = await matchLevel1(db, '123456', 150000, 'CZK');
    expect(candidates).toHaveLength(0);
  });

  it('returns empty for empty VS', async () => {
    const db = makeMockDb({ 'orders.orders': [ORDER_EXACT] });
    const candidates = await matchLevel1(db, '', 150000, 'CZK');
    expect(candidates).toHaveLength(0);
    expect(db.query).not.toHaveBeenCalled();
  });

  it('returns empty when no orders found', async () => {
    const db = makeMockDb({});
    const candidates = await matchLevel1(db, '123456', 150000, 'CZK');
    expect(candidates).toHaveLength(0);
  });
});

/* ================================================================== */
/* Level 2: VS match, different amount                                */
/* ================================================================== */

describe('matchLevel2', () => {
  it('returns candidate for partial payment', async () => {
    const db = makeMockDb({ 'orders.orders': [ORDER_DIFFERENT_AMOUNT] });
    const candidates = await matchLevel2(db, '123456', 150000, 'CZK');

    expect(candidates).toHaveLength(1);
    expect(candidates[0].matchLevel).toBe(2);
    expect(candidates[0].matchScore).toBeLessThan(0.91);
    expect(candidates[0].matchScore).toBeGreaterThan(0.5);
    expect(candidates[0].matchReasons).toEqual(
      expect.arrayContaining([expect.stringContaining('Partial payment')]),
    );
  });

  it('returns candidate for overpayment', async () => {
    const db = makeMockDb({ 'orders.orders': [{ ...ORDER_EXACT, total_halire: 100000 }] });
    const candidates = await matchLevel2(db, '123456', 150000, 'CZK');

    expect(candidates).toHaveLength(1);
    expect(candidates[0].matchReasons).toEqual(
      expect.arrayContaining([expect.stringContaining('Overpayment')]),
    );
  });

  it('skips exact amount matches (handled by L1)', async () => {
    const db = makeMockDb({ 'orders.orders': [ORDER_EXACT] });
    const candidates = await matchLevel2(db, '123456', 150000, 'CZK');
    expect(candidates).toHaveLength(0);
  });

  it('returns empty for empty VS', async () => {
    const db = makeMockDb();
    const candidates = await matchLevel2(db, '', 150000, 'CZK');
    expect(candidates).toHaveLength(0);
  });
});

/* ================================================================== */
/* Level 3: Fuzzy amount + counterparty                               */
/* ================================================================== */

describe('matchLevel3', () => {
  it('finds orders within tolerance', async () => {
    const db = makeMockDb({ 'orders.orders': [ORDER_EXACT] });
    const candidates = await matchLevel3(db, 150050, 'CZK', undefined, undefined, 100);

    expect(candidates).toHaveLength(1);
    expect(candidates[0].matchLevel).toBe(3);
    expect(candidates[0].matchScore).toBeLessThanOrEqual(0.89);
  });

  it('boosts score with counterparty info', async () => {
    const db = makeMockDb({ 'orders.orders': [ORDER_EXACT] });

    const withoutInfo = await matchLevel3(db, 150000, 'CZK');
    const withInfo = await matchLevel3(db, 150000, 'CZK', 'CZ1234', 'Jan Novák');

    expect(withInfo).toHaveLength(1);
    expect(withoutInfo).toHaveLength(1);
    expect(withInfo[0].matchScore).toBeGreaterThan(withoutInfo[0].matchScore);
  });

  it('caps score at 0.89', async () => {
    const db = makeMockDb({ 'orders.orders': [ORDER_EXACT] });
    const candidates = await matchLevel3(db, 150000, 'CZK', 'CZ1234', 'Test', 100);
    expect(candidates[0].matchScore).toBeLessThanOrEqual(0.89);
  });
});

/* ================================================================== */
/* Level 4: AI matching                                               */
/* ================================================================== */

describe('matchLevel4', () => {
  beforeEach(() => {
    setAiMatchProvider(null as any);
  });

  it('returns empty when no AI provider set', async () => {
    setAiMatchProvider(null as any);
    const db = makeMockDb({ 'orders.orders': [ORDER_EXACT] });
    const candidates = await matchLevel4(db, { id: 'bp-1' }, 'CZK');
    expect(candidates).toHaveLength(0);
  });

  it('calls AI provider and returns capped results', async () => {
    const mockProvider = vi.fn().mockResolvedValue([
      { orderId: 'order-1', score: 0.95, reason: 'Pattern match on description' },
    ]);
    setAiMatchProvider(mockProvider);

    const db = makeMockDb({ 'orders.orders': [ORDER_EXACT] });
    const candidates = await matchLevel4(db, { id: 'bp-1', amount: 150000 }, 'CZK');

    expect(candidates).toHaveLength(1);
    expect(candidates[0].matchLevel).toBe(4);
    expect(candidates[0].matchScore).toBeLessThanOrEqual(0.85); // AI capped
    expect(mockProvider).toHaveBeenCalledOnce();
  });

  it('returns empty on AI provider failure', async () => {
    setAiMatchProvider(vi.fn().mockRejectedValue(new Error('AI offline')));
    const db = makeMockDb({ 'orders.orders': [ORDER_EXACT] });
    const candidates = await matchLevel4(db, { id: 'bp-1' }, 'CZK');
    expect(candidates).toHaveLength(0);
  });
});

/* ================================================================== */
/* matchPayment — orchestration                                       */
/* ================================================================== */

describe('matchPayment', () => {
  it('auto-matches on Level 1 exact hit (score=1.0 >= 0.95)', async () => {
    const db = makeMockDb({ 'orders.orders': [ORDER_EXACT] });
    const result = await matchPayment(db, PAYMENT_EXACT);

    expect(result.status).toBe('matched');
    expect(result.autoMatched).toBe(true);
    expect(result.selectedMatch?.orderId).toBe('order-1');
    expect(result.selectedMatch?.matchLevel).toBe(1);
  });

  it('falls through to Level 2 when L1 has no hit', async () => {
    // DB returns the order but with different amount → L1 skip, L2 finds it
    const db = makeMockDb({ 'orders.orders': [ORDER_DIFFERENT_AMOUNT] });
    const result = await matchPayment(db, { ...PAYMENT_EXACT, amountHalire: 150000 });

    expect(result.candidates.length).toBeGreaterThanOrEqual(1);
    expect(result.candidates[0].matchLevel).toBe(2);
    expect(result.autoMatched).toBe(false); // L2 score < 0.95
  });

  it('returns unmatched when nothing found', async () => {
    const db = makeMockDb({});
    const result = await matchPayment(db, PAYMENT_EXACT);

    expect(result.status).toBe('unmatched');
    expect(result.autoMatched).toBe(false);
    expect(result.candidates).toHaveLength(0);
  });

  it('respects custom autoMatchThreshold', async () => {
    const db = makeMockDb({ 'orders.orders': [ORDER_EXACT] });
    // Set threshold impossibly high
    const result = await matchPayment(db, PAYMENT_EXACT, { autoMatchThreshold: 1.1 });

    expect(result.status).toBe('matched');
    expect(result.autoMatched).toBe(false); // 1.0 < 1.1
  });

  it('identifies partial_match status for Level 2 underpayment', async () => {
    const db = makeMockDb({ 'orders.orders': [ORDER_DIFFERENT_AMOUNT] });
    const result = await matchPayment(db, {
      ...PAYMENT_EXACT,
      amountHalire: 100000, // less than 200000
    });

    // L1: no exact match (100000 != 200000), L2: VS matches, amount differs
    expect(result.candidates[0].matchLevel).toBe(2);
    expect(result.status).toBe('partial_match');
    expect(result.remainingHalire).toBe(100000); // 200000 - 100000
  });

  it('skips payment without VS straight to Level 3', async () => {
    const db = makeMockDb({ 'orders.orders': [ORDER_EXACT] });
    const result = await matchPayment(db, {
      ...PAYMENT_EXACT,
      variableSymbol: null,
    });

    // Without VS, L1 and L2 are skipped
    if (result.candidates.length > 0) {
      expect(result.candidates[0].matchLevel).toBe(3);
    }
  });
});

/* ================================================================== */
/* applyMatch                                                         */
/* ================================================================== */

describe('applyMatch', () => {
  it('writes to payment_match_log and updates bank_payment + order in transaction', async () => {
    const db = makeMockDb({});
    const candidate: MatchCandidate = {
      orderId: 'order-1',
      variableSymbol: '123456',
      expectedAmountHalire: 150000,
      currency: 'CZK',
      matchLevel: 1,
      matchScore: 1.0,
      matchReasons: ['Exact match'],
    };

    await applyMatch(db, 'bp-1', 'order-1', candidate, 150000);

    // transaction() should have been called
    expect(db.transaction).toHaveBeenCalledOnce();

    // Check the SQL calls inside the transaction
    const txCalls = db._calls.filter((c) => c.method.startsWith('tx.'));
    expect(txCalls.length).toBe(3); // insert log + update bank_payment + update order

    const logInsert = txCalls.find((c) => c.sql.includes('payment_match_log'));
    expect(logInsert).toBeDefined();

    const orderUpdate = txCalls.find((c) => c.sql.includes('orders.orders'));
    expect(orderUpdate).toBeDefined();
  });

  it('logs manual match with user ID', async () => {
    const db = makeMockDb({});
    const candidate: MatchCandidate = {
      orderId: 'order-1',
      variableSymbol: '123456',
      expectedAmountHalire: 150000,
      currency: 'CZK',
      matchLevel: 1,
      matchScore: 1.0,
      matchReasons: ['Manual match'],
    };

    await applyMatch(db, 'bp-1', 'order-1', candidate, 150000, 'admin-user-1');

    const txCalls = db._calls.filter((c) => c.method === 'tx.execute');
    const logInsert = txCalls.find((c) => c.sql.includes('payment_match_log'));
    // was_auto should be false (user provided), matched_by should be the admin
    expect(logInsert?.params?.[5]).toBe(false); // was_auto
    expect(logInsert?.params?.[6]).toBe('admin-user-1'); // matched_by
  });

  it('does not update order to paid for partial payment', async () => {
    const db = makeMockDb({});
    const candidate: MatchCandidate = {
      orderId: 'order-1',
      variableSymbol: '123456',
      expectedAmountHalire: 200000,
      currency: 'CZK',
      matchLevel: 2,
      matchScore: 0.85,
      matchReasons: ['Partial'],
    };

    await applyMatch(db, 'bp-1', 'order-1', candidate, 100000);

    const txCalls = db._calls.filter((c) => c.method === 'tx.execute');
    const orderUpdate = txCalls.find((c) => c.sql.includes('orders.orders') && c.sql.includes('paid'));
    // Partial payment (100000 < 200000) should NOT mark order as paid
    expect(orderUpdate).toBeUndefined();
  });
});

/* ================================================================== */
/* getMatchingStats                                                    */
/* ================================================================== */

describe('getMatchingStats', () => {
  it('aggregates stats from audit log', async () => {
    const db = makeMockDb({
      'payment_match_log': [
        { match_level: 1, was_auto: true, cnt: 10 },
        { match_level: 2, was_auto: true, cnt: 3 },
        { match_level: 1, was_auto: false, cnt: 5 },
      ],
      'bank_payments': [{ cnt: '7' }],
    });

    const stats = await getMatchingStats(db);

    expect(stats.autoMatched).toBe(13);
    expect(stats.manuallyMatched).toBe(5);
    expect(stats.unmatched).toBe(7);
    expect(stats.totalTransactions).toBe(25);
    expect(stats.byLevel[1]).toBe(15);
    expect(stats.byLevel[2]).toBe(3);
    expect(stats.matchRatePercent).toBeCloseTo(72, 0);
  });

  it('returns zeros when no data', async () => {
    const db = makeMockDb({});
    const stats = await getMatchingStats(db);

    expect(stats.totalTransactions).toBe(0);
    expect(stats.matchRatePercent).toBe(0);
  });
});
