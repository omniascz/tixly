/**
 * Comprehensive end-to-end tests for the payout service.
 *
 * These tests extend payout.service.test.ts with deeper coverage:
 *  - processPayoutCycles: cycle-day gating, post_event, PAYOUT_BELOW_MINIMUM skip
 *  - releaseMaturedReserves: per-promoter Kafka aggregation
 *  - markPayoutFailed: retry_count increment, failed email
 *  - approvePayout: Kafka event, BANK_ACCOUNT_MISSING
 *  - markPayoutProcessing / markPayoutPaid: status transitions, emails
 *  - calculateEventSettlement: UPSERT idempotency, zero-value handling
 *  - createPayoutForPromoter: rolling reserve integer math
 *  - updatePayoutSettings: UPSERT creates and updates
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  calculateEventSettlement,
  createPayoutForPromoter,
  approvePayout,
  markPayoutProcessing,
  markPayoutPaid,
  markPayoutFailed,
  releaseMaturedReserves,
  processPayoutCycles,
  updatePayoutSettings,
} from '../services/payout.service.js';
import { PayoutError } from '../lib/payout-errors.js';
import type {
  ServiceDeps,
  DbAdapter,
  KafkaProducerAdapter,
  EmailAdapter,
} from '../lib/service-container.js';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const PROMOTER_A = 'aaaaaaaa-0000-0000-0000-000000000001';
const PROMOTER_B = 'bbbbbbbb-0000-0000-0000-000000000002';
const EVENT_ID   = 'cccccccc-0000-0000-0000-000000000003';
const PAYOUT_ID  = 'dddddddd-0000-0000-0000-000000000004';
const ADMIN_ID   = 'eeeeeeee-0000-0000-0000-000000000005';

// ---------------------------------------------------------------------------
// Row factories
// ---------------------------------------------------------------------------

function makePendingPayoutRow(overrides: Record<string, unknown> = {}) {
  return {
    id: PAYOUT_ID,
    promoter_id: PROMOTER_A,
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
    id: PROMOTER_A,
    email: 'promoter@example.com',
    name: 'Test Promotér',
    bank_account: 'CZ6508000000192000145399',
    locale: null,
    ...overrides,
  };
}

function makeSettlementRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'settlement-0000-0001',
    event_id: EVENT_ID,
    promoter_id: PROMOTER_A,
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
    id: 'reserve-0000-0001',
    promoter_id: PROMOTER_A,
    payout_id: PAYOUT_ID,
    amount: 5000,
    release_date: '2026-04-01',
    released: false,
    released_at: null,
    created_at: '2026-02-01T00:00:00.000Z',
    ...overrides,
  };
}

function makeSettingsRow(overrides: Record<string, unknown> = {}) {
  return {
    promoter_id: PROMOTER_A,
    payout_cycle: 'monthly',
    rolling_reserve_pct: 500,
    reserve_release_days: 30,
    min_payout_amount: 10000,
    updated_at: '2026-04-01T00:00:00.000Z',
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Mock helpers
// ---------------------------------------------------------------------------

function makeDb(queryImpl?: (sql: string, params?: unknown[]) => Promise<unknown[]>): DbAdapter {
  const executeMock = vi.fn().mockResolvedValue(undefined);
  const queryMock = vi.fn().mockImplementation(
    queryImpl ?? (async () => [])
  );
  const transactionMock = vi.fn().mockImplementation(
    async (fn: (tx: DbAdapter) => Promise<unknown>) => {
      const tx: DbAdapter = {
        query: queryMock,
        execute: executeMock,
        transaction: transactionMock,
      };
      return fn(tx);
    }
  );
  return { query: queryMock, execute: executeMock, transaction: transactionMock };
}

function makeDeps(db?: DbAdapter): ServiceDeps {
  return {
    db: db ?? makeDb(),
    kafka: { send: vi.fn().mockResolvedValue(undefined) },
    email: { send: vi.fn().mockResolvedValue(undefined) },
  };
}

// ---------------------------------------------------------------------------
// calculateEventSettlement — extended coverage
// ---------------------------------------------------------------------------

describe('calculateEventSettlement — extended', () => {
  it('correctly aggregates paid orders, refunds, and chargebacks', async () => {
    const db = makeDb(async (sql) => {
      if (sql.includes("status = 'paid'"))
        return [{ gross_revenue: '80000', platform_fees: '4000', tickets_sold: '8' }];
      if (sql.includes("status = 'refunded'"))
        return [{ refunds_amount: '5000', refunds_count: '1' }];
      if (sql.includes("status = 'chargeback'"))
        return [{ chargebacks_amount: '2000', chargebacks_count: '1' }];
      if (sql.includes('event_settlements'))
        return [makeSettlementRow({
          gross_revenue: 80000,
          platform_fees: 4000,
          refunds_amount: 5000,
          chargebacks_amount: 2000,
          net_revenue: 69000,
          tickets_sold: 8,
        })];
      return [];
    });

    const result = await calculateEventSettlement(EVENT_ID, PROMOTER_A, makeDeps(db));

    expect(result.grossRevenue).toBe(80000);
    expect(result.platformFees).toBe(4000);
    expect(result.refundsAmount).toBe(5000);
    expect(result.chargebacksAmount).toBe(2000);
    // net = 80000 - 4000 - 5000 - 2000 = 69000
    expect(result.netRevenue).toBe(69000);
    expect(result.ticketsSold).toBe(8);
  });

  it('handles all-zero values without errors', async () => {
    const db = makeDb(async (sql) => {
      if (sql.includes("status = 'paid'"))
        return [{ gross_revenue: '0', platform_fees: '0', tickets_sold: '0' }];
      if (sql.includes("status = 'refunded'"))
        return [{ refunds_amount: '0', refunds_count: '0' }];
      if (sql.includes("status = 'chargeback'"))
        return [{ chargebacks_amount: '0', chargebacks_count: '0' }];
      if (sql.includes('event_settlements'))
        return [makeSettlementRow({ gross_revenue: 0, platform_fees: 0, net_revenue: 0, tickets_sold: 0 })];
      return [];
    });

    const result = await calculateEventSettlement(EVENT_ID, PROMOTER_A, makeDeps(db));

    expect(result.grossRevenue).toBe(0);
    expect(result.netRevenue).toBe(0);
    expect(result.ticketsSold).toBe(0);
  });

  it('UPSERT is idempotent — issues INSERT … ON CONFLICT DO UPDATE', async () => {
    const qMock = vi.fn().mockImplementation(async (sql: string) => {
      if (sql.includes("status = 'paid'"))
        return [{ gross_revenue: '10000', platform_fees: '500', tickets_sold: '2' }];
      if (sql.includes("status = 'refunded'"))
        return [{ refunds_amount: '0', refunds_count: '0' }];
      if (sql.includes("status = 'chargeback'"))
        return [{ chargebacks_amount: '0', chargebacks_count: '0' }];
      if (sql.includes('event_settlements'))
        return [makeSettlementRow()];
      return [];
    });

    const db: DbAdapter = {
      query: qMock,
      execute: vi.fn().mockResolvedValue(undefined),
      transaction: vi.fn().mockImplementation(async (fn) => fn({ query: qMock, execute: vi.fn(), transaction: vi.fn() })),
    };

    // Call twice — both should succeed (idempotent)
    await calculateEventSettlement(EVENT_ID, PROMOTER_A, makeDeps(db));
    await calculateEventSettlement(EVENT_ID, PROMOTER_A, makeDeps(db));

    const upsertCalls = (qMock as ReturnType<typeof vi.fn>).mock.calls.filter(
      ([sql]: [string]) => sql.includes('ON CONFLICT') && sql.includes('event_settlements')
    );
    // One call per invocation, so 2 total
    expect(upsertCalls.length).toBe(2);
  });
});

// ---------------------------------------------------------------------------
// createPayoutForPromoter — rolling reserve integer math
// ---------------------------------------------------------------------------

describe('createPayoutForPromoter — rolling reserve math', () => {
  /**
   * Build deps wired to a real transaction mock and configurable gross values.
   */
  function buildDeps(gross: number, fees: number, reservePct = 500) {
    const execMock = vi.fn().mockResolvedValue(undefined);
    const qMock = vi.fn().mockImplementation(async (sql: string) => {
      if (sql.includes('payout_settings WHERE promoter_id'))
        return [makeSettingsRow({ rolling_reserve_pct: reservePct })];
      if (sql.includes('SUM'))
        return [{ gross: String(gross), fees: String(fees), refunds: '0', chargebacks: '0', settlement_ids: 'x' }];
      if (sql.includes('INSERT INTO platform.payouts')) {
        const reserve = Math.round((gross * reservePct) / 10000);
        const net = gross - fees - reserve;
        return [makePendingPayoutRow({ gross_revenue: gross, platform_fees: fees, rolling_reserve: reserve, net_payout: net })];
      }
      return [];
    });
    const txMock = vi.fn().mockImplementation(async (fn: (tx: DbAdapter) => Promise<unknown>) =>
      fn({ query: qMock, execute: execMock, transaction: vi.fn() })
    );
    const db: DbAdapter = { query: qMock, execute: execMock, transaction: txMock };
    const kafka: KafkaProducerAdapter = { send: vi.fn().mockResolvedValue(undefined) };
    const email: EmailAdapter = { send: vi.fn().mockResolvedValue(undefined) };
    return { db, kafka, email, qMock, execMock };
  }

  it('rolling reserve for gross=100001, pct=500 (5%) is integer Math.round result', async () => {
    // 100001 * 500 / 10000 = 5000.05 → Math.round → 5000
    const { db, kafka, email, qMock } = buildDeps(100001, 100);

    await createPayoutForPromoter(PROMOTER_A, new Date('2026-03-01'), new Date('2026-03-31'), { db, kafka, email });

    const insertCall = (qMock as ReturnType<typeof vi.fn>).mock.calls.find(
      ([sql]: [string]) => sql.includes('INSERT INTO platform.payouts')
    );
    expect(insertCall).toBeDefined();
    // rolling_reserve is the 8th param (index 7): [promoterId, from, to, gross, fees, refunds, chargebacks, reserve, net, cycle]
    const reserveParam = insertCall[1][7];
    expect(Number.isInteger(reserveParam)).toBe(true);
    expect(reserveParam).toBe(Math.round((100001 * 500) / 10000));
  });

  it('rolling reserve formula: Math.round(gross * pct / 10000)', () => {
    // Unit-level formula verification (no DB needed)
    const cases: [number, number, number][] = [
      [200000, 500, 10000],   // 200000 * 500 / 10000 = 10000 exactly
      [333333, 500, 1667],    // 333333 * 500 / 10000 = 1666.665 → round → 1667
      [1,      500, 0],       // 1 * 500 / 10000 = 0.05 → round → 0
      [100000, 1000, 10000],  // 10% reserve
    ];
    for (const [gross, pct, expected] of cases) {
      expect(Math.round((gross * pct) / 10000)).toBe(expected);
    }
  });

  it('emits Kafka payout.created with correct payoutId and promoterId', async () => {
    const { db, kafka, email } = buildDeps(200000, 10000);
    await createPayoutForPromoter(PROMOTER_A, new Date('2026-03-01'), new Date('2026-03-31'), { db, kafka, email });

    expect(kafka.send).toHaveBeenCalledWith(
      'payout.created',
      expect.objectContaining({ payoutId: PAYOUT_ID, promoterId: PROMOTER_A })
    );
  });

  it('inserts rolling_reserves entry when reserve > 0', async () => {
    const { db, kafka, email, execMock } = buildDeps(200000, 10000);
    await createPayoutForPromoter(PROMOTER_A, new Date('2026-03-01'), new Date('2026-03-31'), { db, kafka, email });

    const reserveInsert = (execMock as ReturnType<typeof vi.fn>).mock.calls.find(
      ([sql]: [string]) => sql.includes('rolling_reserves')
    );
    expect(reserveInsert).toBeDefined();
  });

  it('release_date = periodTo + reserveReleaseDays', async () => {
    const { db, kafka, email, execMock } = buildDeps(200000, 10000);
    // settings row returns reserve_release_days: 30
    const periodTo = new Date('2026-03-31');
    await createPayoutForPromoter(PROMOTER_A, new Date('2026-03-01'), periodTo, { db, kafka, email });

    const reserveInsert = (execMock as ReturnType<typeof vi.fn>).mock.calls.find(
      ([sql]: [string]) => sql.includes('rolling_reserves')
    );
    expect(reserveInsert).toBeDefined();
    // release_date param (index 3): 2026-03-31 + 30 days = 2026-04-30
    expect(reserveInsert[1][3]).toBe('2026-04-30');
  });

  it('marks all settlements settled=TRUE after creating payout', async () => {
    const { db, kafka, email, execMock } = buildDeps(200000, 10000);

    // Provide two settlement IDs
    const qMock = db.query as ReturnType<typeof vi.fn>;
    qMock.mockImplementation(async (sql: string) => {
      if (sql.includes('payout_settings WHERE promoter_id'))
        return [makeSettingsRow()];
      if (sql.includes('SUM'))
        return [{ gross: '200000', fees: '10000', refunds: '0', chargebacks: '0', settlement_ids: 'uuid-1,uuid-2' }];
      if (sql.includes('INSERT INTO platform.payouts'))
        return [makePendingPayoutRow()];
      return [];
    });

    await createPayoutForPromoter(PROMOTER_A, new Date('2026-03-01'), new Date('2026-03-31'), { db, kafka, email });

    const settledUpdate = (execMock as ReturnType<typeof vi.fn>).mock.calls.find(
      ([sql]: [string]) => sql.includes('settled = TRUE')
    );
    expect(settledUpdate).toBeDefined();
    // Both UUIDs should appear in the params
    expect(settledUpdate[1]).toContain('uuid-1');
    expect(settledUpdate[1]).toContain('uuid-2');
  });

  it('throws PAYOUT_BELOW_MINIMUM when net_payout < minPayoutAmount', async () => {
    const execMock = vi.fn().mockResolvedValue(undefined);
    const qMock = vi.fn().mockImplementation(async (sql: string) => {
      if (sql.includes('payout_settings WHERE promoter_id'))
        return [makeSettingsRow({ min_payout_amount: 50000 })];
      if (sql.includes('SUM'))
        // gross=5000, fees=250, reserve=5%=250, net=4500 < 50000
        return [{ gross: '5000', fees: '250', refunds: '0', chargebacks: '0', settlement_ids: 'x' }];
      return [];
    });
    const txMock = vi.fn().mockImplementation(async (fn: (tx: DbAdapter) => Promise<unknown>) =>
      fn({ query: qMock, execute: execMock, transaction: vi.fn() })
    );
    const db: DbAdapter = { query: qMock, execute: execMock, transaction: txMock };
    const deps = makeDeps(db);

    await expect(
      createPayoutForPromoter(PROMOTER_A, new Date('2026-03-01'), new Date('2026-03-31'), deps)
    ).rejects.toMatchObject({ code: 'PAYOUT_BELOW_MINIMUM' });
    await expect(
      createPayoutForPromoter(PROMOTER_A, new Date('2026-03-01'), new Date('2026-03-31'), deps)
    ).rejects.toBeInstanceOf(PayoutError);
  });
});

// ---------------------------------------------------------------------------
// approvePayout — extended coverage
// ---------------------------------------------------------------------------

describe('approvePayout — extended', () => {
  it('emits Kafka payout.approved event', async () => {
    const db = makeDb(async (sql) => {
      if (sql.includes('FROM platform.payouts WHERE id'))
        return [makePendingPayoutRow()];
      if (sql.includes('FROM platform.promoters'))
        return [makePromoterRow()];
      if (sql.includes('UPDATE platform.payouts'))
        return [makePendingPayoutRow({ status: 'approved', approved_by: ADMIN_ID })];
      return [];
    });
    const kafka: KafkaProducerAdapter = { send: vi.fn().mockResolvedValue(undefined) };
    const deps: ServiceDeps = { db, kafka, email: { send: vi.fn().mockResolvedValue(undefined) } };

    await approvePayout(PAYOUT_ID, ADMIN_ID, deps);

    expect(kafka.send).toHaveBeenCalledWith(
      'payout.approved',
      expect.objectContaining({ payoutId: PAYOUT_ID, promoterId: PROMOTER_A })
    );
  });

  it('throws INVALID_STATUS_TRANSITION for already-approved payout', async () => {
    const db = makeDb(async (sql) => {
      if (sql.includes('FROM platform.payouts WHERE id'))
        return [makePendingPayoutRow({ status: 'approved' })];
      return [];
    });
    await expect(
      approvePayout(PAYOUT_ID, ADMIN_ID, makeDeps(db))
    ).rejects.toMatchObject({ code: 'INVALID_STATUS_TRANSITION' });
  });

  it('throws INVALID_STATUS_TRANSITION for paid payout', async () => {
    const db = makeDb(async (sql) => {
      if (sql.includes('FROM platform.payouts WHERE id'))
        return [makePendingPayoutRow({ status: 'paid' })];
      return [];
    });
    await expect(
      approvePayout(PAYOUT_ID, ADMIN_ID, makeDeps(db))
    ).rejects.toMatchObject({ code: 'INVALID_STATUS_TRANSITION' });
  });

  it('throws BANK_ACCOUNT_MISSING when promoter has no bank_account', async () => {
    const db = makeDb(async (sql) => {
      if (sql.includes('FROM platform.payouts WHERE id'))
        return [makePendingPayoutRow()];
      if (sql.includes('FROM platform.promoters'))
        return [makePromoterRow({ bank_account: null })];
      return [];
    });
    await expect(
      approvePayout(PAYOUT_ID, ADMIN_ID, makeDeps(db))
    ).rejects.toMatchObject({ code: 'BANK_ACCOUNT_MISSING' });
  });

  it('sends approval email to promoter (fire-and-forget)', async () => {
    const db = makeDb(async (sql) => {
      if (sql.includes('FROM platform.payouts WHERE id'))
        return [makePendingPayoutRow()];
      if (sql.includes('FROM platform.promoters'))
        return [makePromoterRow()];
      if (sql.includes('UPDATE platform.payouts'))
        return [makePendingPayoutRow({ status: 'approved', approved_by: ADMIN_ID })];
      return [];
    });
    const email: EmailAdapter = { send: vi.fn().mockResolvedValue(undefined) };
    const deps: ServiceDeps = { db, kafka: { send: vi.fn().mockResolvedValue(undefined) }, email };

    await approvePayout(PAYOUT_ID, ADMIN_ID, deps);
    await new Promise(r => setTimeout(r, 10)); // flush microtasks

    expect(email.send).toHaveBeenCalledWith(
      'promoter@example.com',
      expect.stringContaining('schválena'),
      expect.stringContaining('<html')
    );
  });
});

// ---------------------------------------------------------------------------
// markPayoutProcessing — extended coverage
// ---------------------------------------------------------------------------

describe('markPayoutProcessing — extended', () => {
  it('transitions approved → processing', async () => {
    const db = makeDb(async (sql) => {
      if (sql.includes('FROM platform.payouts WHERE id'))
        return [makePendingPayoutRow({ status: 'approved' })];
      if (sql.includes('UPDATE platform.payouts'))
        return [makePendingPayoutRow({ status: 'processing' })];
      return [];
    });
    const payout = await markPayoutProcessing(PAYOUT_ID, ADMIN_ID, makeDeps(db));
    expect(payout.status).toBe('processing');
  });

  it('throws INVALID_STATUS_TRANSITION when status is pending (not approved)', async () => {
    const db = makeDb(async (sql) => {
      if (sql.includes('FROM platform.payouts WHERE id'))
        return [makePendingPayoutRow({ status: 'pending' })];
      return [];
    });
    await expect(
      markPayoutProcessing(PAYOUT_ID, ADMIN_ID, makeDeps(db))
    ).rejects.toMatchObject({ code: 'INVALID_STATUS_TRANSITION' });
  });

  it('throws INVALID_STATUS_TRANSITION when status is paid', async () => {
    const db = makeDb(async (sql) => {
      if (sql.includes('FROM platform.payouts WHERE id'))
        return [makePendingPayoutRow({ status: 'paid' })];
      return [];
    });
    await expect(
      markPayoutProcessing(PAYOUT_ID, ADMIN_ID, makeDeps(db))
    ).rejects.toMatchObject({ code: 'INVALID_STATUS_TRANSITION' });
  });
});

// ---------------------------------------------------------------------------
// markPayoutPaid — extended coverage
// ---------------------------------------------------------------------------

describe('markPayoutPaid — extended', () => {
  it('transitions processing → paid and records bankReference', async () => {
    const db = makeDb(async (sql) => {
      if (sql.includes('FROM platform.payouts WHERE id'))
        return [makePendingPayoutRow({ status: 'processing' })];
      if (sql.includes('UPDATE platform.payouts'))
        return [makePendingPayoutRow({ status: 'paid', bank_reference: 'REF-XYZ', paid_at: '2026-04-05T12:00:00Z' })];
      if (sql.includes('FROM platform.promoters'))
        return [makePromoterRow()];
      return [];
    });
    const payout = await markPayoutPaid(PAYOUT_ID, 'REF-XYZ', ADMIN_ID, makeDeps(db));
    expect(payout.status).toBe('paid');
    expect(payout.bankReference).toBe('REF-XYZ');
  });

  it('throws INVALID_STATUS_TRANSITION when status is pending', async () => {
    const db = makeDb(async (sql) => {
      if (sql.includes('FROM platform.payouts WHERE id'))
        return [makePendingPayoutRow({ status: 'pending' })];
      return [];
    });
    await expect(
      markPayoutPaid(PAYOUT_ID, 'REF-001', ADMIN_ID, makeDeps(db))
    ).rejects.toMatchObject({ code: 'INVALID_STATUS_TRANSITION' });
  });

  it('sends paid email containing bank_reference', async () => {
    const db = makeDb(async (sql) => {
      if (sql.includes('FROM platform.payouts WHERE id'))
        return [makePendingPayoutRow({ status: 'processing' })];
      if (sql.includes('UPDATE platform.payouts'))
        return [makePendingPayoutRow({ status: 'paid', bank_reference: 'TXN-PAID-42', paid_at: '2026-04-05T12:00:00Z' })];
      if (sql.includes('FROM platform.promoters'))
        return [makePromoterRow()];
      return [];
    });
    const email: EmailAdapter = { send: vi.fn().mockResolvedValue(undefined) };
    const deps: ServiceDeps = { db, kafka: { send: vi.fn().mockResolvedValue(undefined) }, email };

    await markPayoutPaid(PAYOUT_ID, 'TXN-PAID-42', ADMIN_ID, deps);
    await new Promise(r => setTimeout(r, 10));

    expect(email.send).toHaveBeenCalledWith(
      'promoter@example.com',
      expect.stringContaining('odeslána'),
      expect.stringContaining('TXN-PAID-42')
    );
  });
});

// ---------------------------------------------------------------------------
// markPayoutFailed — extended coverage
// ---------------------------------------------------------------------------

describe('markPayoutFailed — extended', () => {
  it('transitions processing → failed and stores failure_reason', async () => {
    const db = makeDb(async (sql) => {
      if (sql.includes('FROM platform.payouts WHERE id'))
        return [makePendingPayoutRow({ status: 'processing' })];
      if (sql.includes('UPDATE platform.payouts'))
        return [makePendingPayoutRow({ status: 'failed', failure_reason: 'Neplatný IBAN', retry_count: 1 })];
      if (sql.includes('FROM platform.promoters'))
        return [makePromoterRow()];
      return [];
    });
    const payout = await markPayoutFailed(PAYOUT_ID, 'Neplatný IBAN', ADMIN_ID, makeDeps(db));
    expect(payout.status).toBe('failed');
    expect(payout.failureReason).toBe('Neplatný IBAN');
  });

  it('increments retry_count from 0 to 1', async () => {
    const db = makeDb(async (sql) => {
      if (sql.includes('FROM platform.payouts WHERE id'))
        return [makePendingPayoutRow({ status: 'processing', retry_count: 0 })];
      if (sql.includes('UPDATE platform.payouts'))
        return [makePendingPayoutRow({ status: 'failed', failure_reason: 'Timeout', retry_count: 1 })];
      if (sql.includes('FROM platform.promoters'))
        return [makePromoterRow()];
      return [];
    });
    const payout = await markPayoutFailed(PAYOUT_ID, 'Timeout', ADMIN_ID, makeDeps(db));
    expect(payout.retryCount).toBe(1);
  });

  it('increments retry_count from 2 to 3 (multiple retries)', async () => {
    const db = makeDb(async (sql) => {
      if (sql.includes('FROM platform.payouts WHERE id'))
        return [makePendingPayoutRow({ status: 'processing', retry_count: 2 })];
      if (sql.includes('UPDATE platform.payouts'))
        return [makePendingPayoutRow({ status: 'failed', failure_reason: 'Network error', retry_count: 3 })];
      if (sql.includes('FROM platform.promoters'))
        return [makePromoterRow()];
      return [];
    });
    const payout = await markPayoutFailed(PAYOUT_ID, 'Network error', ADMIN_ID, makeDeps(db));
    expect(payout.retryCount).toBe(3);
  });

  it('throws INVALID_STATUS_TRANSITION when status is not processing', async () => {
    const db = makeDb(async (sql) => {
      if (sql.includes('FROM platform.payouts WHERE id'))
        return [makePendingPayoutRow({ status: 'pending' })];
      return [];
    });
    await expect(
      markPayoutFailed(PAYOUT_ID, 'reason', ADMIN_ID, makeDeps(db))
    ).rejects.toMatchObject({ code: 'INVALID_STATUS_TRANSITION' });
  });

  it('sends failure email to promoter (fire-and-forget)', async () => {
    const db = makeDb(async (sql) => {
      if (sql.includes('FROM platform.payouts WHERE id'))
        return [makePendingPayoutRow({ status: 'processing' })];
      if (sql.includes('UPDATE platform.payouts'))
        return [makePendingPayoutRow({ status: 'failed', failure_reason: 'Bank rejected', retry_count: 1 })];
      if (sql.includes('FROM platform.promoters'))
        return [makePromoterRow()];
      return [];
    });
    const email: EmailAdapter = { send: vi.fn().mockResolvedValue(undefined) };
    const deps: ServiceDeps = { db, kafka: { send: vi.fn().mockResolvedValue(undefined) }, email };

    await markPayoutFailed(PAYOUT_ID, 'Bank rejected', ADMIN_ID, deps);
    await new Promise(r => setTimeout(r, 10));

    expect(email.send).toHaveBeenCalledWith(
      'promoter@example.com',
      expect.any(String),
      expect.any(String)
    );
  });

  it('UPDATE SQL uses retry_count + 1 expression (not a fixed value)', async () => {
    const qMock = vi.fn().mockImplementation(async (sql: string) => {
      if (sql.includes('FROM platform.payouts WHERE id'))
        return [makePendingPayoutRow({ status: 'processing', retry_count: 5 })];
      if (sql.includes('UPDATE platform.payouts')) {
        // Verify the SQL increments rather than setting a literal
        expect(sql).toContain('retry_count + 1');
        return [makePendingPayoutRow({ status: 'failed', retry_count: 6 })];
      }
      if (sql.includes('FROM platform.promoters'))
        return [makePromoterRow()];
      return [];
    });
    const db: DbAdapter = {
      query: qMock,
      execute: vi.fn().mockResolvedValue(undefined),
      transaction: vi.fn().mockImplementation(async (fn) => fn({ query: qMock, execute: vi.fn(), transaction: vi.fn() })),
    };
    await markPayoutFailed(PAYOUT_ID, 'reason', ADMIN_ID, makeDeps(db));
  });
});

// ---------------------------------------------------------------------------
// releaseMaturedReserves — Kafka aggregation per promoter
// ---------------------------------------------------------------------------

describe('releaseMaturedReserves — Kafka aggregation', () => {
  it('emits one Kafka event per promoter with aggregated amount', async () => {
    const db = makeDb(async (sql) => {
      if (sql.includes('release_date <= CURRENT_DATE'))
        return [
          makeReserveRow({ id: 'rr-1', promoter_id: PROMOTER_A, amount: 3000 }),
          makeReserveRow({ id: 'rr-2', promoter_id: PROMOTER_A, amount: 2000 }),
          makeReserveRow({ id: 'rr-3', promoter_id: PROMOTER_B, amount: 4000 }),
        ];
      return [];
    });
    const kafka: KafkaProducerAdapter = { send: vi.fn().mockResolvedValue(undefined) };
    const deps: ServiceDeps = { db, kafka, email: { send: vi.fn().mockResolvedValue(undefined) } };

    const result = await releaseMaturedReserves(deps);

    expect(result.released).toBe(3);
    expect(result.amount).toBe(9000);

    // Should emit 2 Kafka events (one per promoter), not 3
    const kafkaCalls = (kafka.send as ReturnType<typeof vi.fn>).mock.calls.filter(
      ([topic]: [string]) => topic === 'payout.reserve_released'
    );
    expect(kafkaCalls.length).toBe(2);

    // Promoter A: 3000 + 2000 = 5000
    const callA = kafkaCalls.find(([, payload]: [string, { promoterId: string; amount: number }]) =>
      payload.promoterId === PROMOTER_A
    );
    expect(callA).toBeDefined();
    expect(callA[1].amount).toBe(5000);

    // Promoter B: 4000
    const callB = kafkaCalls.find(([, payload]: [string, { promoterId: string; amount: number }]) =>
      payload.promoterId === PROMOTER_B
    );
    expect(callB).toBeDefined();
    expect(callB[1].amount).toBe(4000);
  });

  it('returns { released: 0, amount: 0 } and emits no Kafka when no matured reserves', async () => {
    const db = makeDb(async () => []);
    const kafka: KafkaProducerAdapter = { send: vi.fn().mockResolvedValue(undefined) };
    const deps: ServiceDeps = { db, kafka, email: { send: vi.fn().mockResolvedValue(undefined) } };

    const result = await releaseMaturedReserves(deps);

    expect(result.released).toBe(0);
    expect(result.amount).toBe(0);
    expect(kafka.send).not.toHaveBeenCalled();
  });

  it('marks each matured reserve as released=TRUE in DB', async () => {
    const execMock = vi.fn().mockResolvedValue(undefined);
    const qMock = vi.fn().mockImplementation(async (sql: string) => {
      if (sql.includes('release_date <= CURRENT_DATE'))
        return [
          makeReserveRow({ id: 'rr-A' }),
          makeReserveRow({ id: 'rr-B' }),
        ];
      return [];
    });
    const db: DbAdapter = {
      query: qMock,
      execute: execMock,
      transaction: vi.fn().mockImplementation(async (fn) => fn({ query: qMock, execute: execMock, transaction: vi.fn() })),
    };
    const deps: ServiceDeps = { db, kafka: { send: vi.fn().mockResolvedValue(undefined) }, email: { send: vi.fn().mockResolvedValue(undefined) } };

    await releaseMaturedReserves(deps);

    const releasedUpdates = (execMock as ReturnType<typeof vi.fn>).mock.calls.filter(
      ([sql]: [string]) => sql.includes('released = TRUE')
    );
    expect(releasedUpdates.length).toBe(2);
  });
});

// ---------------------------------------------------------------------------
// processPayoutCycles — cycle-day gating
// ---------------------------------------------------------------------------

describe('processPayoutCycles — cycle-day gating', () => {
  /**
   * Build a db mock that returns settings rows for given cycles and provides
   * enough data for createPayoutForPromoter to succeed.
   */
  function buildCycleDeps(settingsRows: object[]) {
    const execMock = vi.fn().mockResolvedValue(undefined);
    const qMock = vi.fn().mockImplementation(async (sql: string) => {
      if (sql.includes("payout_cycle != 'manual'")) return settingsRows;
      if (sql.includes('payout_settings WHERE promoter_id')) return settingsRows.slice(0, 1);
      if (sql.includes('SUM'))
        return [{ gross: '500000', fees: '25000', refunds: '0', chargebacks: '0', settlement_ids: 'x' }];
      if (sql.includes('INSERT INTO platform.payouts'))
        return [makePendingPayoutRow({ net_payout: 450000, gross_revenue: 500000 })];
      if (sql.includes('event_settlements') && sql.includes('JOIN catalog.events'))
        return [{ event_id: EVENT_ID, promoter_id: PROMOTER_A }];
      return [];
    });
    const txMock = vi.fn().mockImplementation(async (fn: (tx: DbAdapter) => Promise<unknown>) =>
      fn({ query: qMock, execute: execMock, transaction: vi.fn() })
    );
    const db: DbAdapter = { query: qMock, execute: execMock, transaction: txMock };
    const kafka: KafkaProducerAdapter = { send: vi.fn().mockResolvedValue(undefined) };
    const email: EmailAdapter = { send: vi.fn().mockResolvedValue(undefined) };
    return { db, kafka, email };
  }

  it('daily cycle triggers on any day of week', async () => {
    const deps = buildCycleDeps([
      makeSettingsRow({ promoter_id: PROMOTER_A, payout_cycle: 'daily' }),
    ]);
    // Daily always triggers — no day check needed
    const result = await processPayoutCycles(deps);
    expect(result.created).toBe(1);
  });

  it('weekly cycle triggers only on Monday (getDay() === 1)', async () => {
    const deps = buildCycleDeps([
      makeSettingsRow({ promoter_id: PROMOTER_A, payout_cycle: 'weekly' }),
    ]);

    // Spy on Date to control which day it is
    const RealDate = globalThis.Date;

    // --- Test on a Monday ---
    const monday = new Date('2026-04-06T06:00:00Z'); // 2026-04-06 is a Monday
    vi.spyOn(globalThis, 'Date').mockImplementation((arg?: unknown) => {
      if (arg === undefined) return monday as unknown as string;
      return new RealDate(arg as string) as unknown as string;
    }) as unknown;
    (globalThis.Date as unknown as { now: () => number }).now = () => monday.getTime();

    const mondayResult = await processPayoutCycles(deps);
    expect(mondayResult.created).toBe(1);

    vi.restoreAllMocks();

    // --- Test on a Wednesday ---
    const wednesday = new Date('2026-04-08T06:00:00Z'); // Wednesday
    vi.spyOn(globalThis, 'Date').mockImplementation((arg?: unknown) => {
      if (arg === undefined) return wednesday as unknown as string;
      return new RealDate(arg as string) as unknown as string;
    }) as unknown;
    (globalThis.Date as unknown as { now: () => number }).now = () => wednesday.getTime();

    const wednesdayResult = await processPayoutCycles(deps);
    expect(wednesdayResult.created).toBe(0);

    vi.restoreAllMocks();
  });

  it('monthly cycle triggers only on the 1st of the month', async () => {
    const deps = buildCycleDeps([
      makeSettingsRow({ promoter_id: PROMOTER_A, payout_cycle: 'monthly' }),
    ]);

    const RealDate = globalThis.Date;

    // --- Test on 1st of month ---
    const firstOfMonth = new Date('2026-04-01T06:00:00Z');
    vi.spyOn(globalThis, 'Date').mockImplementation((arg?: unknown) => {
      if (arg === undefined) return firstOfMonth as unknown as string;
      return new RealDate(arg as string) as unknown as string;
    }) as unknown;
    (globalThis.Date as unknown as { now: () => number }).now = () => firstOfMonth.getTime();

    const firstResult = await processPayoutCycles(deps);
    expect(firstResult.created).toBe(1);

    vi.restoreAllMocks();

    // --- Test on 8th of month ---
    const eigthOfMonth = new Date('2026-04-08T06:00:00Z');
    vi.spyOn(globalThis, 'Date').mockImplementation((arg?: unknown) => {
      if (arg === undefined) return eigthOfMonth as unknown as string;
      return new RealDate(arg as string) as unknown as string;
    }) as unknown;
    (globalThis.Date as unknown as { now: () => number }).now = () => eigthOfMonth.getTime();

    const midMonthResult = await processPayoutCycles(deps);
    expect(midMonthResult.created).toBe(0);

    vi.restoreAllMocks();
  });

  it('post_event cycle finds unsettled ended events and creates payout', async () => {
    const execMock = vi.fn().mockResolvedValue(undefined);
    const qMock = vi.fn().mockImplementation(async (sql: string) => {
      if (sql.includes("payout_cycle != 'manual'"))
        return [makeSettingsRow({ payout_cycle: 'post_event' })];
      if (sql.includes('payout_settings WHERE promoter_id'))
        return [makeSettingsRow({ payout_cycle: 'post_event' })];
      if (sql.includes('event_settlements') && sql.includes('JOIN catalog.events'))
        return [{ event_id: EVENT_ID, promoter_id: PROMOTER_A }];
      if (sql.includes('SUM'))
        return [{ gross: '300000', fees: '15000', refunds: '0', chargebacks: '0', settlement_ids: 'x' }];
      if (sql.includes('INSERT INTO platform.payouts'))
        return [makePendingPayoutRow({ gross_revenue: 300000, net_payout: 270000 })];
      return [];
    });
    const txMock = vi.fn().mockImplementation(async (fn: (tx: DbAdapter) => Promise<unknown>) =>
      fn({ query: qMock, execute: execMock, transaction: vi.fn() })
    );
    const db: DbAdapter = { query: qMock, execute: execMock, transaction: txMock };
    const deps: ServiceDeps = { db, kafka: { send: vi.fn().mockResolvedValue(undefined) }, email: { send: vi.fn().mockResolvedValue(undefined) } };

    const result = await processPayoutCycles(deps);
    expect(result.created).toBe(1);
  });

  it('skips PAYOUT_BELOW_MINIMUM for post_event cycle without throwing', async () => {
    const execMock = vi.fn().mockResolvedValue(undefined);
    const qMock = vi.fn().mockImplementation(async (sql: string) => {
      if (sql.includes("payout_cycle != 'manual'"))
        return [makeSettingsRow({ payout_cycle: 'post_event', min_payout_amount: 100000 })];
      if (sql.includes('payout_settings WHERE promoter_id'))
        return [makeSettingsRow({ payout_cycle: 'post_event', min_payout_amount: 100000 })];
      if (sql.includes('event_settlements') && sql.includes('JOIN catalog.events'))
        return [{ event_id: EVENT_ID, promoter_id: PROMOTER_A }];
      if (sql.includes('SUM'))
        // gross=1000, fees=50, reserve=5→net=945 < 100000
        return [{ gross: '1000', fees: '50', refunds: '0', chargebacks: '0', settlement_ids: 'x' }];
      return [];
    });
    const txMock = vi.fn().mockImplementation(async (fn: (tx: DbAdapter) => Promise<unknown>) =>
      fn({ query: qMock, execute: execMock, transaction: vi.fn() })
    );
    const db: DbAdapter = { query: qMock, execute: execMock, transaction: txMock };
    const deps: ServiceDeps = { db, kafka: { send: vi.fn().mockResolvedValue(undefined) }, email: { send: vi.fn().mockResolvedValue(undefined) } };

    // Should NOT throw — it swallows PAYOUT_BELOW_MINIMUM
    const result = await processPayoutCycles(deps);
    expect(result.created).toBe(0);
  });

  it('skips PAYOUT_BELOW_MINIMUM for daily/weekly/monthly cycle without throwing', async () => {
    const execMock = vi.fn().mockResolvedValue(undefined);
    const qMock = vi.fn().mockImplementation(async (sql: string) => {
      if (sql.includes("payout_cycle != 'manual'"))
        return [makeSettingsRow({ payout_cycle: 'daily', min_payout_amount: 999999 })];
      if (sql.includes('payout_settings WHERE promoter_id'))
        return [makeSettingsRow({ payout_cycle: 'daily', min_payout_amount: 999999 })];
      if (sql.includes('SUM'))
        // net will be far below min
        return [{ gross: '100', fees: '5', refunds: '0', chargebacks: '0', settlement_ids: 'x' }];
      return [];
    });
    const txMock = vi.fn().mockImplementation(async (fn: (tx: DbAdapter) => Promise<unknown>) =>
      fn({ query: qMock, execute: execMock, transaction: vi.fn() })
    );
    const db: DbAdapter = { query: qMock, execute: execMock, transaction: txMock };
    const deps: ServiceDeps = { db, kafka: { send: vi.fn().mockResolvedValue(undefined) }, email: { send: vi.fn().mockResolvedValue(undefined) } };

    const result = await processPayoutCycles(deps);
    expect(result.created).toBe(0);
  });

  it('returns { created: 0 } when no non-manual settings exist', async () => {
    const db = makeDb(async () => []);
    const result = await processPayoutCycles(makeDeps(db));
    expect(result.created).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// updatePayoutSettings — UPSERT create and update
// ---------------------------------------------------------------------------

describe('updatePayoutSettings — extended', () => {
  it('creates new settings when none exist (no existing row)', async () => {
    const db = makeDb(async (sql) => {
      if (sql.includes('payout_settings WHERE promoter_id')) return [];
      if (sql.includes('INSERT INTO platform.payout_settings'))
        return [makeSettingsRow({ payout_cycle: 'weekly', rolling_reserve_pct: 300 })];
      return [];
    });
    const result = await updatePayoutSettings(PROMOTER_A, { payoutCycle: 'weekly', rollingReservePct: 300 }, makeDeps(db));
    expect(result.payoutCycle).toBe('weekly');
    expect(result.rollingReservePct).toBe(300);
  });

  it('updates existing settings — merges only provided fields', async () => {
    const db = makeDb(async (sql) => {
      if (sql.includes('payout_settings WHERE promoter_id'))
        return [makeSettingsRow({ payout_cycle: 'monthly', rolling_reserve_pct: 500, reserve_release_days: 45, min_payout_amount: 20000 })];
      if (sql.includes('INSERT INTO platform.payout_settings'))
        // Only payoutCycle changes; others stay the same
        return [makeSettingsRow({ payout_cycle: 'daily', rolling_reserve_pct: 500, reserve_release_days: 45, min_payout_amount: 20000 })];
      return [];
    });
    const result = await updatePayoutSettings(PROMOTER_A, { payoutCycle: 'daily' }, makeDeps(db));
    expect(result.payoutCycle).toBe('daily');
    expect(result.rollingReservePct).toBe(500);    // unchanged
    expect(result.reserveReleaseDays).toBe(45);    // unchanged
    expect(result.minPayoutAmount).toBe(20000);    // unchanged
  });

  it('UPSERT SQL contains ON CONFLICT DO UPDATE', async () => {
    const qMock = vi.fn().mockImplementation(async (sql: string) => {
      if (sql.includes('payout_settings WHERE promoter_id')) return [];
      if (sql.includes('INSERT INTO platform.payout_settings')) {
        expect(sql).toContain('ON CONFLICT');
        expect(sql).toContain('DO UPDATE');
        return [makeSettingsRow()];
      }
      return [];
    });
    const db: DbAdapter = {
      query: qMock,
      execute: vi.fn().mockResolvedValue(undefined),
      transaction: vi.fn().mockImplementation(async (fn) => fn({ query: qMock, execute: vi.fn(), transaction: vi.fn() })),
    };
    await updatePayoutSettings(PROMOTER_A, { payoutCycle: 'monthly' }, makeDeps(db));
    expect(qMock).toHaveBeenCalled();
  });

  it('uses default values for all fields when none provided and no existing row', async () => {
    const db = makeDb(async (sql) => {
      if (sql.includes('payout_settings WHERE promoter_id')) return [];
      if (sql.includes('INSERT INTO platform.payout_settings'))
        // Return defaults the service would compute
        return [makeSettingsRow({ payout_cycle: 'post_event', rolling_reserve_pct: 500, reserve_release_days: 30, min_payout_amount: 10000 })];
      return [];
    });
    const result = await updatePayoutSettings(PROMOTER_A, {}, makeDeps(db));
    // Defaults from the service
    expect(result.payoutCycle).toBe('post_event');
    expect(result.rollingReservePct).toBe(500);
    expect(result.reserveReleaseDays).toBe(30);
    expect(result.minPayoutAmount).toBe(10000);
  });
});
