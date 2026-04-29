import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  openTapSession,
  completeTapPayment,
  closeTapSession,
  getSessionSummary,
} from '../services/tap-to-pay.service.js';
import type { DbAdapter } from '../services/tap-to-pay.service.js';

function makeSessionRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'tap-session-001',
    event_id: 'event-001',
    promoter_id: 'promoter-001',
    staff_user_id: 'staff-001',
    device_id: 'iPhone-ABC123',
    platform: 'ios',
    stripe_reader_id: null,
    status: 'active',
    opened_at: '2026-04-14T10:00:00Z',
    closed_at: null,
    ...overrides,
  };
}

function makeTxRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'tap-tx-001',
    session_id: 'tap-session-001',
    payment_intent_id: 'pi_test_abc',
    amount_hellers: 50000,
    currency: 'CZK',
    status: 'pending',
    ticket_type_id: null,
    quantity: 1,
    error_code: null,
    created_at: '2026-04-14T10:05:00Z',
    completed_at: null,
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

describe('openTapSession', () => {
  it('otevře Tap to Pay session', async () => {
    const db = makeDb([[makeSessionRow()]]);
    const result = await openTapSession({
      eventId: 'event-001',
      promoterId: 'promoter-001',
      staffUserId: 'staff-001',
      deviceId: 'iPhone-ABC123',
      platform: 'ios',
    }, db);

    expect(result.deviceId).toBe('iPhone-ABC123');
    expect(result.platform).toBe('ios');
    expect(result.status).toBe('active');
  });

  it('odmítne prázdné deviceId', async () => {
    const db = makeDb();
    await expect(openTapSession({
      eventId: 'e', promoterId: 'p', staffUserId: 's',
      deviceId: '   ', platform: 'android',
    }, db)).rejects.toThrow('deviceId is required');
  });
});

describe('completeTapPayment', () => {
  it('označí transakci jako succeeded', async () => {
    const db = makeDb([[makeTxRow({ status: 'succeeded', completed_at: '2026-04-14T10:06:00Z' })]]);
    const result = await completeTapPayment('tap-tx-001', 'succeeded', null, db);
    expect(result.status).toBe('succeeded');
    expect(result.completedAt).toBeTruthy();
  });

  it('označí transakci jako failed s error kódem', async () => {
    const db = makeDb([[makeTxRow({ status: 'failed', error_code: 'CARD_DECLINED' })]]);
    const result = await completeTapPayment('tap-tx-001', 'failed', 'CARD_DECLINED', db);
    expect(result.status).toBe('failed');
    expect(result.errorCode).toBe('CARD_DECLINED');
  });

  it('označí transakci jako cancelled', async () => {
    const db = makeDb([[makeTxRow({ status: 'cancelled' })]]);
    const result = await completeTapPayment('tap-tx-001', 'cancelled', null, db);
    expect(result.status).toBe('cancelled');
  });

  it('vyhodí chybu pro transakci mimo stav pending', async () => {
    const db = makeDb([[]]); // empty = not pending
    await expect(completeTapPayment('tap-tx-001', 'succeeded', null, db))
      .rejects.toThrow('TRANSACTION_NOT_FOUND or not pending');
  });
});

describe('closeTapSession', () => {
  it('zavře session', async () => {
    const db = makeDb([[makeSessionRow({ status: 'closed', closed_at: '2026-04-14T18:00:00Z' })]]);
    const result = await closeTapSession('tap-session-001', 'staff-001', db);
    expect(result.status).toBe('closed');
    expect(result.closedAt).toBeTruthy();
  });

  it('vyhodí chybu pro nenalezenou session', async () => {
    const db = makeDb([[]]); // empty
    await expect(closeTapSession('bad-id', 'staff-001', db))
      .rejects.toThrow('SESSION_NOT_FOUND or already closed');
  });
});

describe('getSessionSummary', () => {
  it('vrátí souhrn transakcí session', async () => {
    const db = makeDb([[{
      total: '5',
      succeeded: '4',
      total_amount: '200000',
    }]]);

    const result = await getSessionSummary('tap-session-001', db);
    expect(result.totalTransactions).toBe(5);
    expect(result.totalSucceeded).toBe(4);
    expect(result.totalAmountHellers).toBe(200000);
  });

  it('vrátí nuly pro prázdnou session', async () => {
    const db = makeDb([[{ total: '0', succeeded: '0', total_amount: '0' }]]);
    const result = await getSessionSummary('tap-session-001', db);
    expect(result.totalAmountHellers).toBe(0);
  });
});
