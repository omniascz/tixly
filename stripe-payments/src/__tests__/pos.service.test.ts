import { describe, it, expect, vi } from 'vitest';
import {
  openPosSession,
  createPosPaymentIntent,
  processCardPayment,
  closePosSession,
  reconcilePos,
  getSessionTransactions,
} from '../services/pos.service.js';
import type { DbAdapter } from '../services/pos.service.js';

function makeSessionRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'session-001',
    event_id: 'event-001',
    promoter_id: 'promoter-001',
    staff_user_id: 'staff-001',
    terminal_id: 'tmr_test_123',
    location_id: 'tml_test_456',
    status: 'open',
    opened_at: '2026-04-14T10:00:00Z',
    closed_at: null,
    reconciled_at: null,
    ...overrides,
  };
}

function makeTransactionRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'tx-001',
    session_id: 'session-001',
    order_id: null,
    payment_intent_id: 'pi_test_abc',
    terminal_reader_id: 'tmr_test_123',
    amount_hellers: 50000,
    currency: 'CZK',
    status: 'succeeded',
    ticket_types: JSON.stringify([{ ticketTypeId: 'tt-001', quantity: 1, unitPriceHellers: 50000 }]),
    payment_method_type: 'card_present',
    created_at: '2026-04-14T10:05:00Z',
    completed_at: '2026-04-14T10:05:30Z',
    ...overrides,
  };
}

function makeDb(queryResults: unknown[][] = [], executeMock = vi.fn()): DbAdapter {
  let callIdx = 0;
  return {
    query: vi.fn(async () => {
      const result = queryResults[callIdx] ?? [];
      callIdx++;
      return result;
    }),
    execute: executeMock,
  };
}

describe('openPosSession', () => {
  it('otevře novou POS session', async () => {
    const db = makeDb([[makeSessionRow()]]);

    const result = await openPosSession('event-001', 'promoter-001', 'staff-001', 'tmr_test_123', 'tml_test_456', db);

    expect(result.eventId).toBe('event-001');
    expect(result.terminalId).toBe('tmr_test_123');
    expect(result.status).toBe('open');
  });

  it('vyhodí VALIDATION_ERROR pro chybějící povinná pole', async () => {
    const db = makeDb([]);

    await expect(openPosSession('', 'promoter-001', 'staff-001', 'tmr_test_123', null, db))
      .rejects.toThrow('VALIDATION_ERROR');
  });
});

describe('createPosPaymentIntent', () => {
  it('vytvoří PaymentIntent přes Stripe Terminal', async () => {
    process.env.STRIPE_SECRET_KEY = 'sk_test_mock';
    vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce({
      ok: true,
      json: async () => ({ id: 'pi_test_abc', client_secret: 'pi_test_abc_secret' }),
    }));

    const db = makeDb(
      [[makeSessionRow()], [makeTransactionRow()]],
    );

    const result = await createPosPaymentIntent(
      'session-001',
      50000,
      'CZK',
      [{ ticketTypeId: 'tt-001', quantity: 1, unitPriceHellers: 50000 }],
      db,
    );

    expect(result.transaction.paymentIntentId).toBe('pi_test_abc');
    expect(result.clientSecret).toBe('pi_test_abc_secret');
    expect(result.transaction.amountHellers).toBe(50000);
  });

  it('vyhodí VALIDATION_ERROR pro nulovou částku', async () => {
    const db = makeDb([]);

    await expect(createPosPaymentIntent('session-001', 0, 'CZK', [], db))
      .rejects.toThrow('VALIDATION_ERROR');
  });

  it('vyhodí SESSION_NOT_FOUND pro neexistující session', async () => {
    vi.stubGlobal('fetch', vi.fn());

    const db = makeDb([[]]); // empty = no open session

    await expect(createPosPaymentIntent('nonexistent', 50000, 'CZK', [], db))
      .rejects.toThrow('SESSION_NOT_FOUND');
  });
});

describe('processCardPayment', () => {
  it('označí transakci jako succeeded', async () => {
    const db = makeDb([[makeTransactionRow({ status: 'succeeded' })]]);

    const result = await processCardPayment('tx-001', 'succeeded', 'card_present', db);

    expect(result.status).toBe('succeeded');
    expect(result.paymentMethodType).toBe('card_present');
  });

  it('označí transakci jako failed', async () => {
    const db = makeDb([[makeTransactionRow({ status: 'failed', payment_method_type: null, completed_at: null })]]);

    const result = await processCardPayment('tx-001', 'failed', null, db);

    expect(result.status).toBe('failed');
  });
});

describe('closePosSession', () => {
  it('uzavře otevřenou session', async () => {
    const db = makeDb([[makeSessionRow({ status: 'closed', closed_at: '2026-04-14T18:00:00Z' })]]);

    const result = await closePosSession('session-001', 'promoter-001', db);

    expect(result.status).toBe('closed');
    expect(result.closedAt).toBeTruthy();
  });

  it('vyhodí SESSION_NOT_FOUND pro uzavřenou session', async () => {
    const db = makeDb([[]]); // no rows = not open

    await expect(closePosSession('session-001', 'promoter-001', db))
      .rejects.toThrow('SESSION_NOT_FOUND');
  });
});

describe('reconcilePos', () => {
  it('vytvoří reconciliation pro session', async () => {
    const db = makeDb([
      // aggregate query
      [{ total_transactions: '3', total_succeeded: '2', total_failed: '1', gross_amount: '100000' }],
      // reconciliation insert
      [{
        id: 'rec-001',
        session_id: 'session-001',
        total_transactions: 3,
        total_succeeded: 2,
        total_failed: 1,
        gross_amount_hellers: '100000',
        net_amount_hellers: '100000',
        discrepancy_hellers: 0,
        reconciled_by: 'staff-001',
        notes: null,
        created_at: '2026-04-14T18:00:00Z',
      }],
    ]);

    const result = await reconcilePos('session-001', 'staff-001', 100000, null, db);

    expect(result.totalTransactions).toBe(3);
    expect(result.totalSucceeded).toBe(2);
    expect(result.grossAmountHellers).toBe(100000);
  });
});

describe('getSessionTransactions', () => {
  it('vrátí všechny transakce v session', async () => {
    const db = makeDb([[
      makeTransactionRow({ id: 'tx-001' }),
      makeTransactionRow({ id: 'tx-002', amount_hellers: 25000 }),
    ]]);

    const result = await getSessionTransactions('session-001', db);

    expect(result).toHaveLength(2);
    expect(result[0].id).toBe('tx-001');
    expect(result[1].amountHellers).toBe(25000);
  });
});
