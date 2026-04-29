import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  calculateEventSettlement,
  createPayoutForPromoter,
  approvePayout,
  markPayoutProcessing,
  markPayoutPaid,
  markPayoutFailed,
  releaseMaturedReserves,
  getPayoutSummary,
  listPayouts,
  getPayoutDetail,
  updatePayoutSettings,
  adminListPayouts,
  processPayoutCycles,
} from '../services/payout.service.js';
import { PayoutError } from '../lib/payout-errors.js';
import type { ServiceDeps, DbAdapter, KafkaProducerAdapter, EmailAdapter } from '../lib/service-container.js';

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

const PROMOTER_ID = 'aaaaaaaa-0000-0000-0000-000000000001';
const EVENT_ID = 'bbbbbbbb-0000-0000-0000-000000000002';
const PAYOUT_ID = 'cccccccc-0000-0000-0000-000000000003';
const ADMIN_ID = 'dddddddd-0000-0000-0000-000000000004';

function makePendingPayoutRow(overrides: Record<string, unknown> = {}) {
  return {
    id: PAYOUT_ID,
    promoter_id: PROMOTER_ID,
    period_from: '2026-03-01T00:00:00.000Z',
    period_to: '2026-03-31T23:59:59.000Z',
    gross_revenue: 100000,
    platform_fees: 5000,
    refunds: 0,
    chargebacks: 0,
    rolling_reserve: 5000,
    net_payout: 90000,
    status: 'pending',
    payout_cycle: 'monthly',
    bank_reference: null,
    paid_at: null,
    failure_reason: null,
    retry_count: 0,
    approved_by: null,
    approved_at: null,
    created_at: '2026-04-01T06:00:00.000Z',
    ...overrides,
  };
}

function makePromoterRow(overrides: Record<string, unknown> = {}) {
  return {
    id: PROMOTER_ID,
    email: 'promoter@example.com',
    name: 'Test Promotér',
    bank_account: 'CZ6508000000192000145399',
    locale: null,
    ...overrides,
  };
}

function makeSettlementRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'eeeeeeee-0000-0000-0000-000000000005',
    event_id: EVENT_ID,
    promoter_id: PROMOTER_ID,
    payout_id: null,
    tickets_sold: 10,
    gross_revenue: 50000,
    platform_fees: 2500,
    refunds_count: 0,
    refunds_amount: 0,
    chargebacks_count: 0,
    chargebacks_amount: 0,
    net_revenue: 47500,
    settled: false,
    settled_at: null,
    created_at: '2026-03-15T10:00:00.000Z',
    updated_at: '2026-03-15T10:00:00.000Z',
    ...overrides,
  };
}

function makeReserveRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'ffffffff-0000-0000-0000-000000000006',
    promoter_id: PROMOTER_ID,
    payout_id: PAYOUT_ID,
    amount: 5000,
    release_date: '2026-03-01',
    released: false,
    released_at: null,
    created_at: '2026-02-01T00:00:00.000Z',
    ...overrides,
  };
}

function makeDb(queryMap: Record<string, unknown[]> = {}): DbAdapter {
  const executeMock = vi.fn().mockResolvedValue(undefined);
  const queryMock = vi.fn().mockImplementation(async (sql: string) => {
    // Match by SQL fragment
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

function makeDeps(dbOverride?: DbAdapter): ServiceDeps {
  const db = dbOverride ?? makeDb();
  const kafka: KafkaProducerAdapter = { send: vi.fn().mockResolvedValue(undefined) };
  const email: EmailAdapter = { send: vi.fn().mockResolvedValue(undefined) };
  return { db, kafka, email };
}

// ---------------------------------------------------------------------------
// calculateEventSettlement
// ---------------------------------------------------------------------------

describe('calculateEventSettlement', () => {
  it('should calculate correct net_revenue = gross - fees - refunds - chargebacks', async () => {
    const db = makeDb();
    const qMock = db.query as ReturnType<typeof vi.fn>;

    let callCount = 0;
    qMock.mockImplementation(async (sql: string) => {
      if (sql.includes("status = 'paid'")) {
        return [{ gross_revenue: '100000', platform_fees: '5000', tickets_sold: '10' }];
      }
      if (sql.includes("status = 'refunded'")) {
        return [{ refunds_amount: '2000', refunds_count: '2' }];
      }
      if (sql.includes("status = 'chargeback'")) {
        return [{ chargebacks_amount: '1000', chargebacks_count: '1' }];
      }
      if (sql.includes('event_settlements')) {
        // UPSERT response
        return [
          makeSettlementRow({
            gross_revenue: 100000,
            platform_fees: 5000,
            refunds_amount: 2000,
            chargebacks_amount: 1000,
            net_revenue: 92000,
            tickets_sold: 10,
          }),
        ];
      }
      callCount++;
      return [];
    });

    const deps = makeDeps(db);
    const result = await calculateEventSettlement(EVENT_ID, PROMOTER_ID, deps);

    expect(result.grossRevenue).toBe(100000);
    expect(result.platformFees).toBe(5000);
    expect(result.refundsAmount).toBe(2000);
    expect(result.chargebacksAmount).toBe(1000);
    expect(result.netRevenue).toBe(92000);
  });

  it('should return net_revenue = 0 for event with no orders', async () => {
    const db = makeDb();
    const qMock = db.query as ReturnType<typeof vi.fn>;

    qMock.mockImplementation(async (sql: string) => {
      if (sql.includes('event_settlements')) {
        return [makeSettlementRow({ gross_revenue: 0, platform_fees: 0, net_revenue: 0, tickets_sold: 0 })];
      }
      // All aggregations return 0
      if (sql.includes("status = 'paid'")) {
        return [{ gross_revenue: '0', platform_fees: '0', tickets_sold: '0' }];
      }
      if (sql.includes("status = 'refunded'")) {
        return [{ refunds_amount: '0', refunds_count: '0' }];
      }
      if (sql.includes("status = 'chargeback'")) {
        return [{ chargebacks_amount: '0', chargebacks_count: '0' }];
      }
      return [];
    });

    const deps = makeDeps(db);
    const result = await calculateEventSettlement(EVENT_ID, PROMOTER_ID, deps);
    expect(result.netRevenue).toBe(0);
    expect(result.ticketsSold).toBe(0);
  });

  it('should UPSERT — calls event_settlements with ON CONFLICT', async () => {
    const db = makeDb();
    const qMock = db.query as ReturnType<typeof vi.fn>;

    qMock.mockImplementation(async (sql: string) => {
      if (sql.includes("status = 'paid'")) return [{ gross_revenue: '5000', platform_fees: '250', tickets_sold: '5' }];
      if (sql.includes("status = 'refunded'")) return [{ refunds_amount: '0', refunds_count: '0' }];
      if (sql.includes("status = 'chargeback'")) return [{ chargebacks_amount: '0', chargebacks_count: '0' }];
      if (sql.includes('event_settlements')) return [makeSettlementRow()];
      return [];
    });

    const deps = makeDeps(db);
    await calculateEventSettlement(EVENT_ID, PROMOTER_ID, deps);

    const calls = (qMock as ReturnType<typeof vi.fn>).mock.calls;
    const upsertCall = calls.find(([sql]: [string]) => sql.includes('ON CONFLICT'));
    expect(upsertCall).toBeDefined();
    expect(upsertCall[0]).toContain('event_settlements');
  });
});

// ---------------------------------------------------------------------------
// createPayoutForPromoter
// ---------------------------------------------------------------------------

describe('createPayoutForPromoter', () => {
  function makeCreateDeps(gross = 200000, fees = 10000, refunds = 0, chargebacks = 0) {
    const db = makeDb();
    const qMock = db.query as ReturnType<typeof vi.fn>;
    const execMock = db.execute as ReturnType<typeof vi.fn>;

    qMock.mockImplementation(async (sql: string) => {
      if (sql.includes('payout_settings')) return []; // use defaults
      if (sql.includes('event_settlements') && sql.includes('SUM')) {
        return [{ gross: String(gross), fees: String(fees), refunds: String(refunds), chargebacks: String(chargebacks), settlement_ids: 'settlement-uuid-1' }];
      }
      if (sql.includes('INSERT INTO platform.payouts')) {
        const rollingReserve = Math.round((gross * 500) / 10000);
        const netPayout = gross - fees - refunds - chargebacks - rollingReserve;
        return [makePendingPayoutRow({ gross_revenue: gross, platform_fees: fees, refunds, chargebacks, rolling_reserve: rollingReserve, net_payout: netPayout })];
      }
      return [];
    });

    const txFn = vi.fn().mockImplementation(async (fn: (tx: DbAdapter) => Promise<unknown>) => {
      const tx: DbAdapter = {
        query: qMock,
        execute: execMock,
        transaction: vi.fn(),
      };
      return fn(tx);
    });
    (db as { transaction: typeof txFn }).transaction = txFn;

    const kafka: KafkaProducerAdapter = { send: vi.fn().mockResolvedValue(undefined) };
    const email: EmailAdapter = { send: vi.fn().mockResolvedValue(undefined) };
    return { db, kafka, email };
  }

  it('should calculate net_payout with 5% rolling reserve correctly', async () => {
    // gross=200000, reserve=5%=10000, fees=10000, net=200000-10000-0-0-10000=180000
    const deps = makeCreateDeps(200000, 10000, 0, 0);
    const payout = await createPayoutForPromoter(
      PROMOTER_ID,
      new Date('2026-03-01'),
      new Date('2026-03-31'),
      deps
    );

    expect(payout.grossRevenue).toBe(200000);
    expect(payout.platformFees).toBe(10000);
    expect(payout.rollingReserve).toBe(10000); // 5% of 200000
    expect(payout.netPayout).toBe(180000);
  });

  it('net_payout = gross - fees - refunds - chargebacks - reserve', async () => {
    // gross=100000, fees=5000, refunds=3000, chargebacks=1000, reserve=5000 → net=86000
    const deps = makeCreateDeps(100000, 5000, 3000, 1000);
    const payout = await createPayoutForPromoter(
      PROMOTER_ID,
      new Date('2026-03-01'),
      new Date('2026-03-31'),
      deps
    );
    expect(payout.netPayout).toBe(86000);
  });

  it('should throw PAYOUT_BELOW_MINIMUM when net < min_payout_amount', async () => {
    // net will be < 10000 (default minimum)
    const db = makeDb();
    const qMock = db.query as ReturnType<typeof vi.fn>;

    qMock.mockImplementation(async (sql: string) => {
      if (sql.includes('payout_settings')) return [];
      if (sql.includes('event_settlements') && sql.includes('SUM')) {
        // gross=5000, fees=500, reserve=250, net=4250 < 10000
        return [{ gross: '5000', fees: '500', refunds: '0', chargebacks: '0', settlement_ids: 'x' }];
      }
      return [];
    });

    const txFn = vi.fn().mockImplementation(async (fn: (tx: DbAdapter) => Promise<unknown>) => fn(db));
    (db as { transaction: typeof txFn }).transaction = txFn;

    const deps = makeDeps(db);

    await expect(
      createPayoutForPromoter(PROMOTER_ID, new Date('2026-03-01'), new Date('2026-03-31'), deps)
    ).rejects.toThrow(PayoutError);

    await expect(
      createPayoutForPromoter(PROMOTER_ID, new Date('2026-03-01'), new Date('2026-03-31'), deps)
    ).rejects.toMatchObject({ code: 'PAYOUT_BELOW_MINIMUM' });
  });

  it('should create rolling_reserves entry with correct release_date', async () => {
    const db = makeDb();
    const qMock = db.query as ReturnType<typeof vi.fn>;
    const execMock = db.execute as ReturnType<typeof vi.fn>;

    qMock.mockImplementation(async (sql: string) => {
      if (sql.includes('payout_settings')) return [{ promoter_id: PROMOTER_ID, payout_cycle: 'monthly', rolling_reserve_pct: 500, reserve_release_days: 30, min_payout_amount: 10000, updated_at: '' }];
      if (sql.includes('SUM')) {
        return [{ gross: '200000', fees: '10000', refunds: '0', chargebacks: '0', settlement_ids: 'x' }];
      }
      if (sql.includes('INSERT INTO platform.payouts')) {
        return [makePendingPayoutRow({ rolling_reserve: 10000, net_payout: 180000 })];
      }
      return [];
    });

    const txFn = vi.fn().mockImplementation(async (fn: (tx: DbAdapter) => Promise<unknown>) => {
      const tx: DbAdapter = { query: qMock, execute: execMock, transaction: vi.fn() };
      return fn(tx);
    });
    (db as { transaction: typeof txFn }).transaction = txFn;
    const deps: ServiceDeps = { db, kafka: { send: vi.fn().mockResolvedValue(undefined) }, email: { send: vi.fn().mockResolvedValue(undefined) } };

    const periodTo = new Date('2026-03-31');
    await createPayoutForPromoter(PROMOTER_ID, new Date('2026-03-01'), periodTo, deps);

    const reserveInsertCall = (execMock as ReturnType<typeof vi.fn>).mock.calls.find(
      ([sql]: [string]) => sql.includes('rolling_reserves')
    );
    expect(reserveInsertCall).toBeDefined();

    // Release date should be periodTo + 30 days = 2026-04-30
    const expectedRelease = '2026-04-30';
    expect(JSON.stringify(reserveInsertCall[1])).toContain(expectedRelease);
  });

  it('should mark settlements as settled=true', async () => {
    const db = makeDb();
    const qMock = db.query as ReturnType<typeof vi.fn>;
    const execMock = db.execute as ReturnType<typeof vi.fn>;

    qMock.mockImplementation(async (sql: string) => {
      if (sql.includes('payout_settings')) return [];
      if (sql.includes('SUM')) {
        return [{ gross: '200000', fees: '10000', refunds: '0', chargebacks: '0', settlement_ids: 'uuid-1,uuid-2' }];
      }
      if (sql.includes('INSERT INTO platform.payouts')) {
        return [makePendingPayoutRow()];
      }
      return [];
    });

    const txFn = vi.fn().mockImplementation(async (fn: (tx: DbAdapter) => Promise<unknown>) => {
      const tx: DbAdapter = { query: qMock, execute: execMock, transaction: vi.fn() };
      return fn(tx);
    });
    (db as { transaction: typeof txFn }).transaction = txFn;
    const deps: ServiceDeps = { db, kafka: { send: vi.fn().mockResolvedValue(undefined) }, email: { send: vi.fn().mockResolvedValue(undefined) } };

    await createPayoutForPromoter(PROMOTER_ID, new Date('2026-03-01'), new Date('2026-03-31'), deps);

    const updateSettledCall = (execMock as ReturnType<typeof vi.fn>).mock.calls.find(
      ([sql]: [string]) => sql.includes('settled = TRUE')
    );
    expect(updateSettledCall).toBeDefined();
  });

  it('should emit Kafka payout.created event', async () => {
    const db = makeDb();
    const qMock = db.query as ReturnType<typeof vi.fn>;
    const execMock = db.execute as ReturnType<typeof vi.fn>;

    qMock.mockImplementation(async (sql: string) => {
      if (sql.includes('payout_settings')) return [];
      if (sql.includes('SUM')) return [{ gross: '200000', fees: '10000', refunds: '0', chargebacks: '0', settlement_ids: 'x' }];
      if (sql.includes('INSERT INTO platform.payouts')) return [makePendingPayoutRow()];
      return [];
    });

    const txFn = vi.fn().mockImplementation(async (fn: (tx: DbAdapter) => Promise<unknown>) => {
      const tx: DbAdapter = { query: qMock, execute: execMock, transaction: vi.fn() };
      return fn(tx);
    });
    (db as { transaction: typeof txFn }).transaction = txFn;

    const kafka: KafkaProducerAdapter = { send: vi.fn().mockResolvedValue(undefined) };
    const deps: ServiceDeps = { db, kafka, email: { send: vi.fn().mockResolvedValue(undefined) } };

    await createPayoutForPromoter(PROMOTER_ID, new Date('2026-03-01'), new Date('2026-03-31'), deps);

    expect(kafka.send).toHaveBeenCalledWith('payout.created', expect.objectContaining({
      payoutId: PAYOUT_ID,
      promoterId: PROMOTER_ID,
    }));
  });

  it('rolling reserve calculation should never produce a float', async () => {
    // Use gross=100001 to ensure division could produce float
    const db = makeDb();
    const qMock = db.query as ReturnType<typeof vi.fn>;
    const execMock = db.execute as ReturnType<typeof vi.fn>;
    let capturedReserve = -1;

    qMock.mockImplementation(async (sql: string) => {
      if (sql.includes('payout_settings')) return [];
      if (sql.includes('SUM')) return [{ gross: '100001', fees: '100', refunds: '0', chargebacks: '0', settlement_ids: 'x' }];
      if (sql.includes('INSERT INTO platform.payouts')) {
        // Capture rolling_reserve from params
        return [makePendingPayoutRow({ net_payout: 89901, rolling_reserve: 5000 })];
      }
      return [];
    });

    const txFn = vi.fn().mockImplementation(async (fn: (tx: DbAdapter) => Promise<unknown>) => {
      const tx: DbAdapter = { query: qMock, execute: execMock, transaction: vi.fn() };
      return fn(tx);
    });
    (db as { transaction: typeof txFn }).transaction = txFn;
    const deps: ServiceDeps = { db, kafka: { send: vi.fn().mockResolvedValue(undefined) }, email: { send: vi.fn().mockResolvedValue(undefined) } };

    await createPayoutForPromoter(PROMOTER_ID, new Date('2026-03-01'), new Date('2026-03-31'), deps);

    // Verify insert was called with integer params (capture via exec calls)
    const insertCall = (qMock as ReturnType<typeof vi.fn>).mock.calls.find(
      ([sql]: [string]) => sql.includes('INSERT INTO platform.payouts')
    );
    expect(insertCall).toBeDefined();
    // Reserve param should be an integer (Math.round result)
    const reserveParam = insertCall[1][7]; // rolling_reserve is 8th param (index 7)
    expect(Number.isInteger(reserveParam)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// approvePayout
// ---------------------------------------------------------------------------

describe('approvePayout', () => {
  it('should transition pending → approved and set approved_by', async () => {
    const db = makeDb();
    const qMock = db.query as ReturnType<typeof vi.fn>;

    qMock.mockImplementation(async (sql: string) => {
      if (sql.includes('FROM platform.payouts WHERE id')) return [makePendingPayoutRow()];
      if (sql.includes('FROM platform.promoters')) return [makePromoterRow()];
      if (sql.includes('UPDATE platform.payouts')) return [makePendingPayoutRow({ status: 'approved', approved_by: ADMIN_ID })];
      return [];
    });

    const deps = makeDeps(db);
    const payout = await approvePayout(PAYOUT_ID, ADMIN_ID, deps);

    expect(payout.status).toBe('approved');
    expect(payout.approvedBy).toBe(ADMIN_ID);
  });

  it('should throw INVALID_STATUS_TRANSITION for non-pending payout', async () => {
    const db = makeDb();
    const qMock = db.query as ReturnType<typeof vi.fn>;

    qMock.mockImplementation(async (sql: string) => {
      if (sql.includes('FROM platform.payouts WHERE id')) return [makePendingPayoutRow({ status: 'approved' })];
      return [];
    });

    const deps = makeDeps(db);
    await expect(approvePayout(PAYOUT_ID, ADMIN_ID, deps)).rejects.toMatchObject({
      code: 'INVALID_STATUS_TRANSITION',
    });
  });

  it('should throw BANK_ACCOUNT_MISSING when promoter has no bank account', async () => {
    const db = makeDb();
    const qMock = db.query as ReturnType<typeof vi.fn>;

    qMock.mockImplementation(async (sql: string) => {
      if (sql.includes('FROM platform.payouts WHERE id')) return [makePendingPayoutRow()];
      if (sql.includes('FROM platform.promoters')) return [makePromoterRow({ bank_account: null })];
      return [];
    });

    const deps = makeDeps(db);
    await expect(approvePayout(PAYOUT_ID, ADMIN_ID, deps)).rejects.toMatchObject({
      code: 'BANK_ACCOUNT_MISSING',
    });
  });

  it('should send email to promoter on approval', async () => {
    const db = makeDb();
    const qMock = db.query as ReturnType<typeof vi.fn>;

    qMock.mockImplementation(async (sql: string) => {
      if (sql.includes('FROM platform.payouts WHERE id')) return [makePendingPayoutRow()];
      if (sql.includes('FROM platform.promoters')) return [makePromoterRow()];
      if (sql.includes('UPDATE platform.payouts')) return [makePendingPayoutRow({ status: 'approved', approved_by: ADMIN_ID })];
      return [];
    });

    const email: EmailAdapter = { send: vi.fn().mockResolvedValue(undefined) };
    const deps: ServiceDeps = {
      db,
      kafka: { send: vi.fn().mockResolvedValue(undefined) },
      email,
    };

    await approvePayout(PAYOUT_ID, ADMIN_ID, deps);

    // Email may be fire-and-forget but should be called
    await new Promise(r => setTimeout(r, 10)); // flush microtasks
    expect(email.send).toHaveBeenCalledWith(
      'promoter@example.com',
      expect.stringContaining('schválena'),
      expect.stringContaining('<html')
    );
  });
});

// ---------------------------------------------------------------------------
// markPayoutProcessing
// ---------------------------------------------------------------------------

describe('markPayoutProcessing', () => {
  it('should transition approved → processing', async () => {
    const db = makeDb();
    const qMock = db.query as ReturnType<typeof vi.fn>;

    qMock.mockImplementation(async (sql: string) => {
      if (sql.includes('FROM platform.payouts WHERE id')) return [makePendingPayoutRow({ status: 'approved' })];
      if (sql.includes('UPDATE platform.payouts')) return [makePendingPayoutRow({ status: 'processing' })];
      return [];
    });

    const deps = makeDeps(db);
    const payout = await markPayoutProcessing(PAYOUT_ID, ADMIN_ID, deps);
    expect(payout.status).toBe('processing');
  });

  it('should throw INVALID_STATUS_TRANSITION for non-approved payout', async () => {
    const db = makeDb();
    const qMock = db.query as ReturnType<typeof vi.fn>;

    qMock.mockImplementation(async (sql: string) => {
      if (sql.includes('FROM platform.payouts WHERE id')) return [makePendingPayoutRow({ status: 'pending' })];
      return [];
    });

    const deps = makeDeps(db);
    await expect(markPayoutProcessing(PAYOUT_ID, ADMIN_ID, deps)).rejects.toMatchObject({
      code: 'INVALID_STATUS_TRANSITION',
    });
  });
});

// ---------------------------------------------------------------------------
// markPayoutPaid
// ---------------------------------------------------------------------------

describe('markPayoutPaid', () => {
  it('should transition processing → paid and store bank_reference', async () => {
    const db = makeDb();
    const qMock = db.query as ReturnType<typeof vi.fn>;

    qMock.mockImplementation(async (sql: string) => {
      if (sql.includes('FROM platform.payouts WHERE id')) return [makePendingPayoutRow({ status: 'processing' })];
      if (sql.includes('UPDATE platform.payouts')) return [makePendingPayoutRow({ status: 'paid', bank_reference: 'TXN-001', paid_at: '2026-04-05T10:00:00Z' })];
      if (sql.includes('FROM platform.promoters')) return [makePromoterRow()];
      return [];
    });

    const deps = makeDeps(db);
    const payout = await markPayoutPaid(PAYOUT_ID, 'TXN-001', ADMIN_ID, deps);

    expect(payout.status).toBe('paid');
    expect(payout.bankReference).toBe('TXN-001');
  });

  it('should send email with bankReference on paid', async () => {
    const db = makeDb();
    const qMock = db.query as ReturnType<typeof vi.fn>;

    qMock.mockImplementation(async (sql: string) => {
      if (sql.includes('FROM platform.payouts WHERE id')) return [makePendingPayoutRow({ status: 'processing' })];
      if (sql.includes('UPDATE platform.payouts')) return [makePendingPayoutRow({ status: 'paid', bank_reference: 'TXN-PAID-999', paid_at: '2026-04-05T12:00:00Z' })];
      if (sql.includes('FROM platform.promoters')) return [makePromoterRow()];
      return [];
    });

    const email: EmailAdapter = { send: vi.fn().mockResolvedValue(undefined) };
    const deps: ServiceDeps = { db, kafka: { send: vi.fn().mockResolvedValue(undefined) }, email };

    await markPayoutPaid(PAYOUT_ID, 'TXN-PAID-999', ADMIN_ID, deps);
    await new Promise(r => setTimeout(r, 10));

    expect(email.send).toHaveBeenCalledWith(
      'promoter@example.com',
      expect.stringContaining('odeslána'),
      expect.stringContaining('TXN-PAID-999')
    );
  });
});

// ---------------------------------------------------------------------------
// markPayoutFailed
// ---------------------------------------------------------------------------

describe('markPayoutFailed', () => {
  it('should transition processing → failed and store reason', async () => {
    const db = makeDb();
    const qMock = db.query as ReturnType<typeof vi.fn>;

    qMock.mockImplementation(async (sql: string) => {
      if (sql.includes('FROM platform.payouts WHERE id')) return [makePendingPayoutRow({ status: 'processing' })];
      if (sql.includes('UPDATE platform.payouts')) return [makePendingPayoutRow({ status: 'failed', failure_reason: 'Neplatný IBAN', retry_count: 1 })];
      if (sql.includes('FROM platform.promoters')) return [makePromoterRow()];
      return [];
    });

    const deps = makeDeps(db);
    const payout = await markPayoutFailed(PAYOUT_ID, 'Neplatný IBAN', ADMIN_ID, deps);

    expect(payout.status).toBe('failed');
    expect(payout.failureReason).toBe('Neplatný IBAN');
  });

  it('should increment retry_count', async () => {
    const db = makeDb();
    const qMock = db.query as ReturnType<typeof vi.fn>;

    qMock.mockImplementation(async (sql: string) => {
      if (sql.includes('FROM platform.payouts WHERE id')) return [makePendingPayoutRow({ status: 'processing', retry_count: 2 })];
      if (sql.includes('UPDATE platform.payouts')) return [makePendingPayoutRow({ status: 'failed', failure_reason: 'Timeout', retry_count: 3 })];
      if (sql.includes('FROM platform.promoters')) return [makePromoterRow()];
      return [];
    });

    const deps = makeDeps(db);
    const payout = await markPayoutFailed(PAYOUT_ID, 'Timeout', ADMIN_ID, deps);
    expect(payout.retryCount).toBe(3);
  });
});

// ---------------------------------------------------------------------------
// releaseMaturedReserves
// ---------------------------------------------------------------------------

describe('releaseMaturedReserves', () => {
  it('should mark released = true for matured reserves', async () => {
    const db = makeDb();
    const qMock = db.query as ReturnType<typeof vi.fn>;
    const execMock = db.execute as ReturnType<typeof vi.fn>;

    qMock.mockImplementation(async (sql: string) => {
      if (sql.includes('release_date <= CURRENT_DATE')) {
        return [
          makeReserveRow({ amount: 5000, release_date: '2026-04-01' }),
          makeReserveRow({ id: 'rr-2', amount: 3000, release_date: '2026-04-02' }),
        ];
      }
      return [];
    });

    const kafka: KafkaProducerAdapter = { send: vi.fn().mockResolvedValue(undefined) };
    const deps: ServiceDeps = { db, kafka, email: { send: vi.fn().mockResolvedValue(undefined) } };

    const result = await releaseMaturedReserves(deps);

    expect(result.released).toBe(2);
    expect(result.amount).toBe(8000);

    const updateCalls = (execMock as ReturnType<typeof vi.fn>).mock.calls.filter(
      ([sql]: [string]) => sql.includes('released = TRUE')
    );
    expect(updateCalls.length).toBe(2);
  });

  it('should NOT process future reserves', async () => {
    const db = makeDb();
    const qMock = db.query as ReturnType<typeof vi.fn>;

    // Simulating DB returning only matured reserves (future filtered by WHERE clause)
    qMock.mockImplementation(async (sql: string) => {
      if (sql.includes('release_date <= CURRENT_DATE')) {
        // Returns empty — DB filtered out future dates
        return [];
      }
      return [];
    });

    const deps = makeDeps(db);
    const result = await releaseMaturedReserves(deps);

    expect(result.released).toBe(0);
    expect(result.amount).toBe(0);
  });

  it('should return correct released count and total amount', async () => {
    const db = makeDb();
    const qMock = db.query as ReturnType<typeof vi.fn>;

    qMock.mockImplementation(async (sql: string) => {
      if (sql.includes('release_date <= CURRENT_DATE')) {
        return [
          makeReserveRow({ amount: 1000 }),
          makeReserveRow({ id: 'rr-2', amount: 2500 }),
          makeReserveRow({ id: 'rr-3', amount: 750 }),
        ];
      }
      return [];
    });

    const kafka: KafkaProducerAdapter = { send: vi.fn().mockResolvedValue(undefined) };
    const deps: ServiceDeps = { db, kafka, email: { send: vi.fn().mockResolvedValue(undefined) } };

    const result = await releaseMaturedReserves(deps);
    expect(result.released).toBe(3);
    expect(result.amount).toBe(4250);
  });
});

// ---------------------------------------------------------------------------
// getPayoutSummary
// ---------------------------------------------------------------------------

describe('getPayoutSummary', () => {
  it('should return correct pending amount sum', async () => {
    const db = makeDb();
    const qMock = db.query as ReturnType<typeof vi.fn>;

    qMock.mockImplementation(async (sql: string) => {
      if (sql.includes("status = 'pending'")) return [{ pending_amount: '45000' }];
      if (sql.includes('release_date <= CURRENT_DATE')) return [{ available: '5000' }];
      if (sql.includes('released = FALSE') && !sql.includes('CURRENT_DATE')) return [{ total: '15000' }];
      if (sql.includes("status = 'paid'")) return [{ paid_at: '2026-03-01T10:00:00Z' }];
      if (sql.includes('payout_settings')) return [{ promoter_id: PROMOTER_ID, payout_cycle: 'monthly', rolling_reserve_pct: 500, reserve_release_days: 30, min_payout_amount: 10000, updated_at: '' }];
      return [];
    });

    const deps = makeDeps(db);
    const summary = await getPayoutSummary(PROMOTER_ID, deps);

    expect(summary.promoterId).toBe(PROMOTER_ID);
    expect(summary.pendingAmount).toBe(45000);
    expect(summary.availableReserve).toBe(5000);
    expect(summary.totalReserveHeld).toBe(15000);
    expect(summary.lastPaidAt).toBe('2026-03-01T10:00:00Z');
  });

  it('should calculate nextPayoutDate for monthly cycle as 1st of next month', async () => {
    const db = makeDb();
    const qMock = db.query as ReturnType<typeof vi.fn>;

    qMock.mockImplementation(async (sql: string) => {
      if (sql.includes("status = 'pending'")) return [{ pending_amount: '0' }];
      if (sql.includes('release_date <= CURRENT_DATE')) return [{ available: '0' }];
      if (sql.includes('released = FALSE') && !sql.includes('CURRENT_DATE')) return [{ total: '0' }];
      if (sql.includes("status = 'paid'")) return [];
      if (sql.includes('payout_settings')) return [{ promoter_id: PROMOTER_ID, payout_cycle: 'monthly', rolling_reserve_pct: 500, reserve_release_days: 30, min_payout_amount: 10000, updated_at: '' }];
      return [];
    });

    const deps = makeDeps(db);
    const summary = await getPayoutSummary(PROMOTER_ID, deps);

    // nextPayoutDate should be 1st of next month
    expect(summary.nextPayoutDate).toBeTruthy();
    expect(summary.nextPayoutDate).toMatch(/^\d{4}-\d{2}-01$/);
  });
});

// ---------------------------------------------------------------------------
// listPayouts
// ---------------------------------------------------------------------------

describe('listPayouts', () => {
  it('should return only payouts for given promoterId', async () => {
    const db = makeDb();
    const qMock = db.query as ReturnType<typeof vi.fn>;

    qMock.mockImplementation(async (sql: string) => {
      if (sql.includes('COUNT')) return [{ total: '3' }];
      if (sql.includes('FROM platform.payouts')) {
        return [
          makePendingPayoutRow({ id: 'p1' }),
          makePendingPayoutRow({ id: 'p2' }),
          makePendingPayoutRow({ id: 'p3' }),
        ];
      }
      return [];
    });

    const deps = makeDeps(db);
    const result = await listPayouts(PROMOTER_ID, { limit: 20, offset: 0 }, deps);

    expect(result.total).toBe(3);
    expect(result.items).toHaveLength(3);
    // All should have the correct promoter
    result.items.forEach(p => expect(p.promoterId).toBe(PROMOTER_ID));
  });
});

// ---------------------------------------------------------------------------
// getPayoutDetail
// ---------------------------------------------------------------------------

describe('getPayoutDetail', () => {
  it('should return SettlementReport with payout, settlements, reserves', async () => {
    const db = makeDb();
    const qMock = db.query as ReturnType<typeof vi.fn>;

    qMock.mockImplementation(async (sql: string) => {
      if (sql.includes('FROM platform.payouts WHERE id')) return [makePendingPayoutRow()];
      if (sql.includes('event_settlements')) return [makeSettlementRow({ payout_id: PAYOUT_ID, settled: true })];
      if (sql.includes('rolling_reserves')) return [makeReserveRow()];
      return [];
    });

    const deps = makeDeps(db);
    const report = await getPayoutDetail(PAYOUT_ID, PROMOTER_ID, deps);

    expect(report.payout.id).toBe(PAYOUT_ID);
    expect(report.settlements).toHaveLength(1);
    expect(report.reserveEntries).toHaveLength(1);
    expect(report).toHaveProperty('summary');
    expect(report.summary).toHaveProperty('totalGross');
    expect(report.summary).toHaveProperty('totalNet');
  });

  it('should throw PAYOUT_NOT_FOUND for foreign promoter (anti-enumeration)', async () => {
    const db = makeDb();
    const qMock = db.query as ReturnType<typeof vi.fn>;

    // Returns empty — because promoter_id doesn't match
    qMock.mockImplementation(async () => []);

    const FOREIGN_PROMOTER = 'ffffffff-ffff-ffff-ffff-ffffffffffff';
    const deps = makeDeps(db);

    await expect(
      getPayoutDetail(PAYOUT_ID, FOREIGN_PROMOTER, deps)
    ).rejects.toMatchObject({ code: 'PAYOUT_NOT_FOUND' });
  });
});

// ---------------------------------------------------------------------------
// updatePayoutSettings
// ---------------------------------------------------------------------------

describe('updatePayoutSettings', () => {
  it('should UPSERT payout settings and return merged result', async () => {
    const db = makeDb();
    const qMock = db.query as ReturnType<typeof vi.fn>;

    qMock.mockImplementation(async (sql: string) => {
      if (sql.includes('payout_settings WHERE promoter_id')) {
        return []; // no existing settings
      }
      if (sql.includes('INSERT INTO platform.payout_settings')) {
        return [{
          promoter_id: PROMOTER_ID,
          payout_cycle: 'weekly',
          rolling_reserve_pct: 300,
          reserve_release_days: 30,
          min_payout_amount: 10000,
          updated_at: '2026-04-05T00:00:00Z',
        }];
      }
      return [];
    });

    const deps = makeDeps(db);
    const result = await updatePayoutSettings(PROMOTER_ID, { payoutCycle: 'weekly', rollingReservePct: 300 }, deps);

    expect(result.promoterId).toBe(PROMOTER_ID);
    expect(result.payoutCycle).toBe('weekly');
    expect(result.rollingReservePct).toBe(300);
  });

  it('should use existing values for unspecified fields', async () => {
    const db = makeDb();
    const qMock = db.query as ReturnType<typeof vi.fn>;

    qMock.mockImplementation(async (sql: string) => {
      if (sql.includes('payout_settings WHERE promoter_id')) {
        return [{
          promoter_id: PROMOTER_ID,
          payout_cycle: 'monthly',
          rolling_reserve_pct: 500,
          reserve_release_days: 45,
          min_payout_amount: 20000,
          updated_at: '2026-03-01T00:00:00Z',
        }];
      }
      if (sql.includes('INSERT INTO platform.payout_settings')) {
        return [{
          promoter_id: PROMOTER_ID,
          payout_cycle: 'weekly',
          rolling_reserve_pct: 500,    // unchanged
          reserve_release_days: 45,   // unchanged
          min_payout_amount: 20000,   // unchanged
          updated_at: '2026-04-05T00:00:00Z',
        }];
      }
      return [];
    });

    const deps = makeDeps(db);
    const result = await updatePayoutSettings(PROMOTER_ID, { payoutCycle: 'weekly' }, deps);

    expect(result.payoutCycle).toBe('weekly');
    expect(result.rollingReservePct).toBe(500);   // kept from existing
    expect(result.reserveReleaseDays).toBe(45);   // kept from existing
    expect(result.minPayoutAmount).toBe(20000);    // kept from existing
  });
});

// ---------------------------------------------------------------------------
// adminListPayouts
// ---------------------------------------------------------------------------

describe('adminListPayouts', () => {
  it('should filter by status correctly', async () => {
    const db = makeDb();
    const qMock = db.query as ReturnType<typeof vi.fn>;

    qMock.mockImplementation(async (sql: string, params?: unknown[]) => {
      if (sql.includes('COUNT')) return [{ total: '1' }];
      if (sql.includes('FROM platform.payouts')) {
        return [makePendingPayoutRow({ status: 'approved' })];
      }
      return [];
    });

    const deps = makeDeps(db);
    const result = await adminListPayouts({ status: 'approved' }, { limit: 20, offset: 0 }, deps);

    expect(result.total).toBe(1);
    expect(result.items[0].status).toBe('approved');

    // Verify status filter was included in query params
    const calls = (qMock as ReturnType<typeof vi.fn>).mock.calls;
    const listCall = calls.find(([sql]: [string]) => sql.includes('FROM platform.payouts') && !sql.includes('COUNT'));
    expect(listCall).toBeDefined();
    expect(listCall[1]).toContain('approved');
  });

  it('should filter by promoterId', async () => {
    const db = makeDb();
    const qMock = db.query as ReturnType<typeof vi.fn>;

    qMock.mockImplementation(async () => {
      return [];
    });

    qMock.mockImplementationOnce(async () => [{ total: '0' }]);
    qMock.mockImplementationOnce(async () => []);

    const deps = makeDeps(db);
    const result = await adminListPayouts({ promoterId: PROMOTER_ID }, { limit: 10, offset: 0 }, deps);

    const calls = (qMock as ReturnType<typeof vi.fn>).mock.calls;
    const filteredCall = calls.find(([, params]: [string, unknown[]]) =>
      Array.isArray(params) && params.includes(PROMOTER_ID)
    );
    expect(filteredCall).toBeDefined();
  });
});

// ---------------------------------------------------------------------------
// processPayoutCycles
// ---------------------------------------------------------------------------

describe('processPayoutCycles', () => {
  it('should create payout for daily cycle promoter', async () => {
    const db = makeDb();
    const qMock = db.query as ReturnType<typeof vi.fn>;
    const execMock = db.execute as ReturnType<typeof vi.fn>;

    qMock.mockImplementation(async (sql: string) => {
      if (sql.includes("payout_cycle != 'manual'")) {
        return [{
          promoter_id: PROMOTER_ID,
          payout_cycle: 'daily',
          rolling_reserve_pct: 500,
          reserve_release_days: 30,
          min_payout_amount: 10000,
          updated_at: '',
        }];
      }
      if (sql.includes('payout_settings WHERE promoter_id')) return [];
      if (sql.includes('SUM')) return [{ gross: '500000', fees: '25000', refunds: '0', chargebacks: '0', settlement_ids: 'x' }];
      if (sql.includes('INSERT INTO platform.payouts')) return [makePendingPayoutRow({ net_payout: 450000 })];
      return [];
    });

    const txFn = vi.fn().mockImplementation(async (fn: (tx: DbAdapter) => Promise<unknown>) => {
      const tx: DbAdapter = { query: qMock, execute: execMock, transaction: vi.fn() };
      return fn(tx);
    });
    (db as { transaction: typeof txFn }).transaction = txFn;

    const kafka: KafkaProducerAdapter = { send: vi.fn().mockResolvedValue(undefined) };
    const deps: ServiceDeps = { db, kafka, email: { send: vi.fn().mockResolvedValue(undefined) } };

    const result = await processPayoutCycles(deps);
    expect(result.created).toBe(1);
  });

  it('weekly cycle should only trigger on Monday (day===1)', async () => {
    const realDate = Date;
    // Mock a Wednesday (2026-04-08 is Wed)
    const wed = new realDate('2026-04-08T12:00:00.000Z');
    vi.spyOn(global, 'Date').mockImplementation(((...args: unknown[]) => {
      if (args.length === 0) return wed;
      // @ts-expect-error spread
      return new realDate(...args);
    }) as unknown as DateConstructor);
    (global.Date as unknown as { now: () => number }).now = () => wed.getTime();

    const db = makeDb();
    const qMock = db.query as ReturnType<typeof vi.fn>;
    qMock.mockImplementation(async (sql: string) => {
      if (sql.includes("payout_cycle != 'manual'")) {
        return [{
          promoter_id: PROMOTER_ID,
          payout_cycle: 'weekly',
          rolling_reserve_pct: 500,
          reserve_release_days: 30,
          min_payout_amount: 10000,
          updated_at: '',
        }];
      }
      return [];
    });

    const deps = makeDeps(db);
    const result = await processPayoutCycles(deps);
    expect(result.created).toBe(0);

    vi.restoreAllMocks();
  });

  it('monthly cycle should only trigger on 1st of month', async () => {
    const realDate = Date;
    // Mock a non-1st day
    const day15 = new realDate('2026-04-15T12:00:00.000Z');
    vi.spyOn(global, 'Date').mockImplementation(((...args: unknown[]) => {
      if (args.length === 0) return day15;
      // @ts-expect-error spread
      return new realDate(...args);
    }) as unknown as DateConstructor);
    (global.Date as unknown as { now: () => number }).now = () => day15.getTime();

    const db = makeDb();
    const qMock = db.query as ReturnType<typeof vi.fn>;
    qMock.mockImplementation(async (sql: string) => {
      if (sql.includes("payout_cycle != 'manual'")) {
        return [{
          promoter_id: PROMOTER_ID,
          payout_cycle: 'monthly',
          rolling_reserve_pct: 500,
          reserve_release_days: 30,
          min_payout_amount: 10000,
          updated_at: '',
        }];
      }
      return [];
    });

    const deps = makeDeps(db);
    const result = await processPayoutCycles(deps);
    expect(result.created).toBe(0);

    vi.restoreAllMocks();
  });

  it('post_event cycle should find unsettled ended events and create payout', async () => {
    const db = makeDb();
    const qMock = db.query as ReturnType<typeof vi.fn>;
    const execMock = db.execute as ReturnType<typeof vi.fn>;

    qMock.mockImplementation(async (sql: string) => {
      if (sql.includes("payout_cycle != 'manual'")) {
        return [{
          promoter_id: PROMOTER_ID,
          payout_cycle: 'post_event',
          rolling_reserve_pct: 500,
          reserve_release_days: 30,
          min_payout_amount: 10000,
          updated_at: '',
        }];
      }
      if (sql.includes('e.end_date <= NOW()')) {
        return [{ event_id: EVENT_ID, promoter_id: PROMOTER_ID }];
      }
      if (sql.includes('payout_settings WHERE promoter_id')) {
        return [{
          promoter_id: PROMOTER_ID,
          payout_cycle: 'post_event',
          rolling_reserve_pct: 500,
          reserve_release_days: 30,
          min_payout_amount: 10000,
          updated_at: '',
        }];
      }
      if (sql.includes('SUM')) {
        return [{ gross: '500000', fees: '25000', refunds: '0', chargebacks: '0', settlement_ids: 'x' }];
      }
      if (sql.includes('INSERT INTO platform.payouts')) {
        return [makePendingPayoutRow({ net_payout: 450000, payout_cycle: 'post_event' })];
      }
      return [];
    });

    const txFn = vi.fn().mockImplementation(async (fn: (tx: DbAdapter) => Promise<unknown>) => {
      const tx: DbAdapter = { query: qMock, execute: execMock, transaction: vi.fn() };
      return fn(tx);
    });
    (db as { transaction: typeof txFn }).transaction = txFn;

    const deps = makeDeps(db);
    const result = await processPayoutCycles(deps);
    expect(result.created).toBeGreaterThanOrEqual(1);
  });

  it('should skip PAYOUT_BELOW_MINIMUM without throwing', async () => {
    const db = makeDb();
    const qMock = db.query as ReturnType<typeof vi.fn>;
    const execMock = db.execute as ReturnType<typeof vi.fn>;

    qMock.mockImplementation(async (sql: string) => {
      if (sql.includes("payout_cycle != 'manual'")) {
        return [{
          promoter_id: PROMOTER_ID,
          payout_cycle: 'daily',
          rolling_reserve_pct: 500,
          reserve_release_days: 30,
          min_payout_amount: 1000000, // very high → will trigger below-minimum
          updated_at: '',
        }];
      }
      if (sql.includes('payout_settings WHERE promoter_id')) {
        return [{
          promoter_id: PROMOTER_ID,
          payout_cycle: 'daily',
          rolling_reserve_pct: 500,
          reserve_release_days: 30,
          min_payout_amount: 1000000,
          updated_at: '',
        }];
      }
      if (sql.includes('SUM')) {
        return [{ gross: '10000', fees: '500', refunds: '0', chargebacks: '0', settlement_ids: 'x' }];
      }
      return [];
    });

    const txFn = vi.fn().mockImplementation(async (fn: (tx: DbAdapter) => Promise<unknown>) => {
      const tx: DbAdapter = { query: qMock, execute: execMock, transaction: vi.fn() };
      return fn(tx);
    });
    (db as { transaction: typeof txFn }).transaction = txFn;

    const deps = makeDeps(db);
    // Must not throw
    const result = await processPayoutCycles(deps);
    expect(result.created).toBe(0);
  });
});
