import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  requestInstantPayout,
  processInstantPayout,
  getInstantPayoutStatus,
  listInstantPayouts,
  cancelInstantPayout,
  calculateFee,
  type DbAdapter,
  type ServiceDeps,
} from '../services/instant-payout.service.js';
import { InstantPayoutError } from '../types/instant-payout.types.js';
import type { StripeAdapter, InstantPayoutStatus } from '../types/instant-payout.types.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const PROMOTER_ID = 'aaaaaaaa-0000-0000-0000-000000000001';
const PAYOUT_ID = 'bbbbbbbb-0000-0000-0000-000000000002';
const STRIPE_PAYOUT_ID = 'po_test_stripe_001';
const DESTINATION_ID = 'card_test_001';

function makePayoutRow(overrides: Record<string, unknown> = {}) {
  return {
    id: PAYOUT_ID,
    promoter_id: PROMOTER_ID,
    amount_czk: 1000,
    fee_czk: 10,
    net_amount_czk: 990,
    method: 'card',
    destination_id: DESTINATION_ID,
    status: 'pending' as InstantPayoutStatus,
    stripe_payout_id: null,
    failure_reason: null,
    requested_at: '2026-04-15T10:00:00.000Z',
    processed_at: null,
    ...overrides,
  };
}

function makeDb(queryMap: Record<string, unknown[]> = {}): DbAdapter {
  const executeMock = vi.fn().mockResolvedValue(undefined);
  const queryMock = vi.fn().mockImplementation(async (sql: string) => {
    for (const [key, val] of Object.entries(queryMap)) {
      if (sql.includes(key)) return val;
    }
    return [];
  });
  const transactionMock = vi.fn().mockImplementation(async (fn: (tx: DbAdapter) => Promise<unknown>) => {
    const tx: DbAdapter = {
      query: queryMock,
      execute: executeMock,
      transaction: transactionMock,
    };
    return fn(tx);
  });
  return { query: queryMock, execute: executeMock, transaction: transactionMock };
}

function makeStripe(): StripeAdapter {
  return {
    createInstantPayout: vi.fn().mockResolvedValue({ id: STRIPE_PAYOUT_ID }),
    cancelPayout: vi.fn().mockResolvedValue(undefined),
    getPayoutStatus: vi.fn().mockResolvedValue({ status: 'paid' }),
  };
}

function makeDeps(dbOverride?: DbAdapter, stripeOverride?: StripeAdapter): ServiceDeps {
  return {
    db: dbOverride ?? makeDb(),
    stripe: stripeOverride ?? makeStripe(),
  };
}

// ---------------------------------------------------------------------------
// Fee calculation
// ---------------------------------------------------------------------------

describe('calculateFee', () => {
  it('returns 1% of amount when result is between min and max', () => {
    expect(calculateFee(5000)).toBe(50);   // 1% of 5000 = 50
    expect(calculateFee(10000)).toBe(100); // 1% of 10000 = 100
  });

  it('returns minimum fee (10 CZK) when 1% is below minimum', () => {
    expect(calculateFee(500)).toBe(10);  // 1% = 5, clamped to 10
    expect(calculateFee(999)).toBe(10); // 1% = 9.99 ~ 10, but Math.round gives 10 exactly
    expect(calculateFee(100)).toBe(10);
  });

  it('returns maximum fee (200 CZK) when 1% exceeds maximum', () => {
    expect(calculateFee(500_000)).toBe(200); // 1% = 5000, clamped to 200
    expect(calculateFee(30000)).toBe(200);   // 1% = 300, clamped to 200
  });

  it('returns exactly 10 CZK for amount of 1000 CZK', () => {
    expect(calculateFee(1000)).toBe(10); // 1% = 10, at minimum boundary
  });

  it('returns exactly 200 CZK for amount of 20000 CZK', () => {
    expect(calculateFee(20000)).toBe(200); // 1% = 200, at maximum boundary
  });
});

// ---------------------------------------------------------------------------
// requestInstantPayout — amount validation
// ---------------------------------------------------------------------------

describe('requestInstantPayout — amount validation', () => {
  it('throws AMOUNT_TOO_LOW when amount is below 500 CZK', async () => {
    const deps = makeDeps();
    await expect(
      requestInstantPayout(
        { promoterId: PROMOTER_ID, amountCzk: 499, method: 'card', destinationId: DESTINATION_ID },
        deps,
      ),
    ).rejects.toThrow(InstantPayoutError);

    await expect(
      requestInstantPayout(
        { promoterId: PROMOTER_ID, amountCzk: 499, method: 'card', destinationId: DESTINATION_ID },
        deps,
      ),
    ).rejects.toMatchObject({ code: 'AMOUNT_TOO_LOW' });
  });

  it('throws AMOUNT_TOO_LOW for amount of 0', async () => {
    const deps = makeDeps();
    await expect(
      requestInstantPayout(
        { promoterId: PROMOTER_ID, amountCzk: 0, method: 'card', destinationId: DESTINATION_ID },
        deps,
      ),
    ).rejects.toMatchObject({ code: 'AMOUNT_TOO_LOW' });
  });

  it('throws AMOUNT_TOO_HIGH when amount exceeds 500,000 CZK', async () => {
    const deps = makeDeps();
    await expect(
      requestInstantPayout(
        { promoterId: PROMOTER_ID, amountCzk: 500_001, method: 'card', destinationId: DESTINATION_ID },
        deps,
      ),
    ).rejects.toMatchObject({ code: 'AMOUNT_TOO_HIGH' });
  });

  it('accepts amount exactly at minimum (500 CZK)', async () => {
    const db = makeDb();
    const qMock = db.query as ReturnType<typeof vi.fn>;
    let callIndex = 0;
    qMock.mockImplementation(async (sql: string) => {
      if (sql.includes("status = 'pending'")) return [];
      if (sql.includes('INSERT INTO instant_payouts')) {
        return [makePayoutRow({ amount_czk: 500, fee_czk: 10, net_amount_czk: 490 })];
      }
      if (sql.includes('UPDATE instant_payouts')) {
        return [makePayoutRow({ amount_czk: 500, fee_czk: 10, net_amount_czk: 490, status: 'processing', stripe_payout_id: STRIPE_PAYOUT_ID })];
      }
      return [];
    });
    const deps = makeDeps(db);
    const result = await requestInstantPayout(
      { promoterId: PROMOTER_ID, amountCzk: 500, method: 'card', destinationId: DESTINATION_ID },
      deps,
    );
    expect(result.amountCzk).toBe(500);
  });

  it('accepts amount exactly at maximum (500,000 CZK)', async () => {
    const db = makeDb();
    const qMock = db.query as ReturnType<typeof vi.fn>;
    qMock.mockImplementation(async (sql: string) => {
      if (sql.includes("status = 'pending'")) return [];
      if (sql.includes('INSERT INTO instant_payouts')) {
        return [makePayoutRow({ amount_czk: 500_000, fee_czk: 200, net_amount_czk: 499_800 })];
      }
      if (sql.includes('UPDATE instant_payouts')) {
        return [makePayoutRow({ amount_czk: 500_000, fee_czk: 200, net_amount_czk: 499_800, status: 'processing', stripe_payout_id: STRIPE_PAYOUT_ID })];
      }
      return [];
    });
    const deps = makeDeps(db);
    const result = await requestInstantPayout(
      { promoterId: PROMOTER_ID, amountCzk: 500_000, method: 'card', destinationId: DESTINATION_ID },
      deps,
    );
    expect(result.amountCzk).toBe(500_000);
  });
});

// ---------------------------------------------------------------------------
// requestInstantPayout — duplicate pending rejection
// ---------------------------------------------------------------------------

describe('requestInstantPayout — duplicate pending', () => {
  it('throws PENDING_PAYOUT_EXISTS when promoter already has a pending payout', async () => {
    const db = makeDb({ "status = 'pending'": [makePayoutRow()] });
    const deps = makeDeps(db);
    await expect(
      requestInstantPayout(
        { promoterId: PROMOTER_ID, amountCzk: 1000, method: 'card', destinationId: DESTINATION_ID },
        deps,
      ),
    ).rejects.toMatchObject({ code: 'PENDING_PAYOUT_EXISTS' });
  });
});

// ---------------------------------------------------------------------------
// requestInstantPayout — successful flow
// ---------------------------------------------------------------------------

describe('requestInstantPayout — successful flow', () => {
  it('inserts row, calls stripe, updates to processing, returns InstantPayout', async () => {
    const db = makeDb();
    const qMock = db.query as ReturnType<typeof vi.fn>;
    const stripe = makeStripe();

    qMock.mockImplementation(async (sql: string) => {
      if (sql.includes("status = 'pending'")) return [];
      if (sql.includes('INSERT INTO instant_payouts')) {
        return [makePayoutRow()];
      }
      if (sql.includes('UPDATE instant_payouts')) {
        return [makePayoutRow({ status: 'processing', stripe_payout_id: STRIPE_PAYOUT_ID })];
      }
      return [];
    });

    const deps = makeDeps(db, stripe);
    const result = await requestInstantPayout(
      { promoterId: PROMOTER_ID, amountCzk: 1000, method: 'card', destinationId: DESTINATION_ID },
      deps,
    );

    expect(stripe.createInstantPayout).toHaveBeenCalledWith({
      amount: 100_000, // 1000 CZK * 100
      currency: 'czk',
      method: 'card',
      destination: DESTINATION_ID,
    });
    expect(result.status).toBe('processing');
    expect(result.stripePayoutId).toBe(STRIPE_PAYOUT_ID);
  });

  it('wraps operation in a transaction', async () => {
    const db = makeDb();
    const qMock = db.query as ReturnType<typeof vi.fn>;
    qMock.mockImplementation(async (sql: string) => {
      if (sql.includes("status = 'pending'")) return [];
      if (sql.includes('INSERT INTO instant_payouts')) return [makePayoutRow()];
      if (sql.includes('UPDATE instant_payouts')) return [makePayoutRow({ status: 'processing', stripe_payout_id: STRIPE_PAYOUT_ID })];
      return [];
    });
    const deps = makeDeps(db);
    await requestInstantPayout(
      { promoterId: PROMOTER_ID, amountCzk: 1000, method: 'card', destinationId: DESTINATION_ID },
      deps,
    );
    expect(db.transaction).toHaveBeenCalled();
  });

  it('calculates feeCzk and netAmountCzk correctly', async () => {
    const db = makeDb();
    const qMock = db.query as ReturnType<typeof vi.fn>;
    qMock.mockImplementation(async (sql: string) => {
      if (sql.includes("status = 'pending'")) return [];
      if (sql.includes('INSERT INTO instant_payouts')) return [makePayoutRow({ amount_czk: 5000, fee_czk: 50, net_amount_czk: 4950 })];
      if (sql.includes('UPDATE instant_payouts')) return [makePayoutRow({ amount_czk: 5000, fee_czk: 50, net_amount_czk: 4950, status: 'processing', stripe_payout_id: STRIPE_PAYOUT_ID })];
      return [];
    });
    const deps = makeDeps(db);
    const result = await requestInstantPayout(
      { promoterId: PROMOTER_ID, amountCzk: 5000, method: 'card', destinationId: DESTINATION_ID },
      deps,
    );
    expect(result.feeCzk).toBe(50);
    expect(result.netAmountCzk).toBe(4950);
  });

  it('throws STRIPE_ERROR when Stripe call fails', async () => {
    const db = makeDb();
    const qMock = db.query as ReturnType<typeof vi.fn>;
    qMock.mockImplementation(async (sql: string) => {
      if (sql.includes("status = 'pending'")) return [];
      if (sql.includes('INSERT INTO instant_payouts')) return [makePayoutRow()];
      return [];
    });
    const stripe = makeStripe();
    (stripe.createInstantPayout as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('Stripe timeout'));
    const deps = makeDeps(db, stripe);
    await expect(
      requestInstantPayout(
        { promoterId: PROMOTER_ID, amountCzk: 1000, method: 'card', destinationId: DESTINATION_ID },
        deps,
      ),
    ).rejects.toMatchObject({ code: 'STRIPE_ERROR' });
  });
});

// ---------------------------------------------------------------------------
// processInstantPayout
// ---------------------------------------------------------------------------

describe('processInstantPayout', () => {
  it('throws PAYOUT_NOT_FOUND when payout does not exist', async () => {
    const deps = makeDeps(makeDb());
    await expect(processInstantPayout('nonexistent-id', deps)).rejects.toMatchObject({
      code: 'PAYOUT_NOT_FOUND',
    });
  });

  it('updates status to paid when Stripe reports paid', async () => {
    const processingRow = makePayoutRow({ status: 'processing', stripe_payout_id: STRIPE_PAYOUT_ID });
    const paidRow = makePayoutRow({ status: 'paid', stripe_payout_id: STRIPE_PAYOUT_ID, processed_at: '2026-04-15T11:00:00.000Z' });
    const db = makeDb();
    const qMock = db.query as ReturnType<typeof vi.fn>;
    qMock.mockImplementation(async (sql: string) => {
      if (sql.includes('SELECT * FROM instant_payouts')) return [processingRow];
      if (sql.includes('UPDATE instant_payouts')) return [paidRow];
      return [];
    });
    const stripe = makeStripe();
    (stripe.getPayoutStatus as ReturnType<typeof vi.fn>).mockResolvedValue({ status: 'paid' });
    const deps = makeDeps(db, stripe);
    const result = await processInstantPayout(PAYOUT_ID, deps);
    expect(result.status).toBe('paid');
  });

  it('updates status to failed when Stripe reports failed', async () => {
    const processingRow = makePayoutRow({ status: 'processing', stripe_payout_id: STRIPE_PAYOUT_ID });
    const failedRow = makePayoutRow({ status: 'failed', stripe_payout_id: STRIPE_PAYOUT_ID, failure_reason: 'Insufficient funds', processed_at: '2026-04-15T11:00:00.000Z' });
    const db = makeDb();
    const qMock = db.query as ReturnType<typeof vi.fn>;
    qMock.mockImplementation(async (sql: string) => {
      if (sql.includes('SELECT * FROM instant_payouts')) return [processingRow];
      if (sql.includes('UPDATE instant_payouts')) return [failedRow];
      return [];
    });
    const stripe = makeStripe();
    (stripe.getPayoutStatus as ReturnType<typeof vi.fn>).mockResolvedValue({ status: 'failed', failureMessage: 'Insufficient funds' });
    const deps = makeDeps(db, stripe);
    const result = await processInstantPayout(PAYOUT_ID, deps);
    expect(result.status).toBe('failed');
    expect(result.failureReason).toBe('Insufficient funds');
  });

  it('returns unchanged payout when Stripe status has not changed', async () => {
    const processingRow = makePayoutRow({ status: 'processing', stripe_payout_id: STRIPE_PAYOUT_ID });
    const db = makeDb();
    const qMock = db.query as ReturnType<typeof vi.fn>;
    qMock.mockImplementation(async (sql: string) => {
      if (sql.includes('SELECT * FROM instant_payouts')) return [processingRow];
      return [];
    });
    const stripe = makeStripe();
    (stripe.getPayoutStatus as ReturnType<typeof vi.fn>).mockResolvedValue({ status: 'processing' });
    const deps = makeDeps(db, stripe);
    const result = await processInstantPayout(PAYOUT_ID, deps);
    expect(result.status).toBe('processing');
    // DB update should NOT have been called
    const qMockFn = db.query as ReturnType<typeof vi.fn>;
    const updateCalls = qMockFn.mock.calls.filter(([sql]: [string]) => sql.includes('UPDATE'));
    expect(updateCalls.length).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// getInstantPayoutStatus
// ---------------------------------------------------------------------------

describe('getInstantPayoutStatus', () => {
  it('returns payout when found', async () => {
    const row = makePayoutRow({ status: 'processing', stripe_payout_id: STRIPE_PAYOUT_ID });
    const db = makeDb({ 'SELECT * FROM instant_payouts': [row] });
    const deps = makeDeps(db);
    const result = await getInstantPayoutStatus(PAYOUT_ID, deps);
    expect(result.id).toBe(PAYOUT_ID);
    expect(result.status).toBe('processing');
  });

  it('throws PAYOUT_NOT_FOUND when payout does not exist', async () => {
    const deps = makeDeps(makeDb());
    await expect(getInstantPayoutStatus('not-found', deps)).rejects.toMatchObject({
      code: 'PAYOUT_NOT_FOUND',
    });
  });
});

// ---------------------------------------------------------------------------
// listInstantPayouts
// ---------------------------------------------------------------------------

describe('listInstantPayouts', () => {
  it('returns all payouts for a promoter', async () => {
    const rows = [
      makePayoutRow({ id: 'id-1', status: 'paid' }),
      makePayoutRow({ id: 'id-2', status: 'processing' }),
    ];
    const db = makeDb({ 'SELECT * FROM instant_payouts': rows });
    const deps = makeDeps(db);
    const result = await listInstantPayouts(PROMOTER_ID, deps);
    expect(result).toHaveLength(2);
    expect(result[0]?.id).toBe('id-1');
    expect(result[1]?.id).toBe('id-2');
  });

  it('returns empty array when promoter has no payouts', async () => {
    const deps = makeDeps(makeDb());
    const result = await listInstantPayouts(PROMOTER_ID, deps);
    expect(result).toEqual([]);
  });

  it('passes promoterId to the query', async () => {
    const db = makeDb();
    const deps = makeDeps(db);
    await listInstantPayouts(PROMOTER_ID, deps);
    const qMockFn = db.query as ReturnType<typeof vi.fn>;
    expect(qMockFn).toHaveBeenCalledWith(
      expect.stringContaining('instant_payouts'),
      [PROMOTER_ID],
    );
  });
});

// ---------------------------------------------------------------------------
// cancelInstantPayout
// ---------------------------------------------------------------------------

describe('cancelInstantPayout', () => {
  it('throws PAYOUT_NOT_FOUND when payout does not exist', async () => {
    const deps = makeDeps(makeDb());
    await expect(cancelInstantPayout('not-found', PROMOTER_ID, deps)).rejects.toMatchObject({
      code: 'PAYOUT_NOT_FOUND',
    });
  });

  it('throws PAYOUT_NOT_CANCELLABLE when status is processing', async () => {
    const row = makePayoutRow({ status: 'processing', stripe_payout_id: STRIPE_PAYOUT_ID });
    const db = makeDb({ 'SELECT * FROM instant_payouts': [row] });
    const deps = makeDeps(db);
    await expect(cancelInstantPayout(PAYOUT_ID, PROMOTER_ID, deps)).rejects.toMatchObject({
      code: 'PAYOUT_NOT_CANCELLABLE',
    });
  });

  it('throws PAYOUT_NOT_CANCELLABLE when status is paid', async () => {
    const row = makePayoutRow({ status: 'paid', stripe_payout_id: STRIPE_PAYOUT_ID });
    const db = makeDb({ 'SELECT * FROM instant_payouts': [row] });
    const deps = makeDeps(db);
    await expect(cancelInstantPayout(PAYOUT_ID, PROMOTER_ID, deps)).rejects.toMatchObject({
      code: 'PAYOUT_NOT_CANCELLABLE',
    });
  });

  it('throws PAYOUT_NOT_CANCELLABLE when status is failed', async () => {
    const row = makePayoutRow({ status: 'failed' });
    const db = makeDb({ 'SELECT * FROM instant_payouts': [row] });
    const deps = makeDeps(db);
    await expect(cancelInstantPayout(PAYOUT_ID, PROMOTER_ID, deps)).rejects.toMatchObject({
      code: 'PAYOUT_NOT_CANCELLABLE',
    });
  });

  it('cancels successfully when status is pending', async () => {
    const pendingRow = makePayoutRow({ status: 'pending' });
    const cancelledRow = makePayoutRow({ status: 'cancelled', processed_at: '2026-04-15T11:00:00.000Z' });
    const db = makeDb();
    const qMock = db.query as ReturnType<typeof vi.fn>;
    qMock.mockImplementation(async (sql: string) => {
      if (sql.includes('SELECT * FROM instant_payouts')) return [pendingRow];
      if (sql.includes('UPDATE instant_payouts')) return [cancelledRow];
      return [];
    });
    const deps = makeDeps(db);
    const result = await cancelInstantPayout(PAYOUT_ID, PROMOTER_ID, deps);
    expect(result.status).toBe('cancelled');
    expect(result.processedAt).not.toBeNull();
  });

  it('does not call stripe.cancelPayout when stripe_payout_id is null', async () => {
    const pendingRow = makePayoutRow({ status: 'pending', stripe_payout_id: null });
    const cancelledRow = makePayoutRow({ status: 'cancelled', processed_at: '2026-04-15T11:00:00.000Z' });
    const db = makeDb();
    const qMock = db.query as ReturnType<typeof vi.fn>;
    qMock.mockImplementation(async (sql: string) => {
      if (sql.includes('SELECT * FROM instant_payouts')) return [pendingRow];
      if (sql.includes('UPDATE instant_payouts')) return [cancelledRow];
      return [];
    });
    const stripe = makeStripe();
    const deps = makeDeps(db, stripe);
    await cancelInstantPayout(PAYOUT_ID, PROMOTER_ID, deps);
    expect(stripe.cancelPayout).not.toHaveBeenCalled();
  });
});
