import { describe, it, expect, vi } from 'vitest';
import {
  issueWristband,
  getWristbandByUid,
  scanEntry,
  topUpWristband,
  debitWristband,
  getWristbandBalance,
} from '../services/rfid.service.js';
import type { DbAdapter } from '../services/rfid.service.js';

function makeWristbandRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'wb-001',
    event_id: 'event-001',
    ticket_id: 'ticket-001',
    uid: 'A1B2C3D4',
    status: 'active',
    balance_hellers: 50000,
    issued_at: '2026-04-14T10:00:00Z',
    activated_at: '2026-04-14T10:00:00Z',
    last_tap_at: null,
    ...overrides,
  };
}

function makeTapRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'tap-001',
    wristband_id: 'wb-001',
    tap_type: 'entry',
    amount_hellers: 0,
    balance_after_hellers: 50000,
    terminal_id: 'gate-A',
    location_label: 'Main Entrance',
    status: 'ok',
    deny_reason: null,
    tapped_at: '2026-04-14T12:00:00Z',
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

describe('issueWristband', () => {
  it('vydá náramek a propojí s vstupenkou', async () => {
    const db = makeDb([[makeWristbandRow()]]);

    const result = await issueWristband('event-001', 'ticket-001', 'a1b2c3d4', db);

    expect(result.uid).toBe('A1B2C3D4');
    expect(result.ticketId).toBe('ticket-001');
    expect(result.status).toBe('active');
  });

  it('vyhodí VALIDATION_ERROR pro prázdné UID', async () => {
    const db = makeDb([]);

    await expect(issueWristband('event-001', 'ticket-001', '', db))
      .rejects.toThrow('VALIDATION_ERROR');
  });
});

describe('getWristbandByUid', () => {
  it('vrátí náramek podle UID', async () => {
    const db = makeDb([[makeWristbandRow()]]);

    const result = await getWristbandByUid('A1B2C3D4', db);

    expect(result).not.toBeNull();
    expect(result?.id).toBe('wb-001');
  });

  it('vrátí null pro neexistující UID', async () => {
    const db = makeDb([[]]); // empty

    const result = await getWristbandByUid('UNKNOWN', db);

    expect(result).toBeNull();
  });
});

describe('scanEntry', () => {
  it('vpustí aktivní náramek na vstupní bráně', async () => {
    const db = makeDb([
      [makeWristbandRow()],   // getWristbandByUid
      [makeTapRow()],          // recordTap INSERT
    ]);

    const result = await scanEntry('A1B2C3D4', 'gate-A', 'Main Entrance', db);

    expect(result.tapType).toBe('entry');
    expect(result.status).toBe('ok');
  });

  it('zamítne blokovaný náramek', async () => {
    const db = makeDb([
      [makeWristbandRow({ status: 'blocked' })],   // getWristbandByUid
      [makeTapRow({ status: 'denied', deny_reason: 'WRISTBAND_BLOCKED' })],  // recordTap
    ]);

    const result = await scanEntry('A1B2C3D4', 'gate-A', null, db);

    expect(result.status).toBe('denied');
    expect(result.denyReason).toBe('WRISTBAND_BLOCKED');
  });

  it('vrátí error pro neznámé UID', async () => {
    const db = makeDb([[]]); // wristband not found

    const result = await scanEntry('UNKNOWN', 'gate-A', null, db);

    expect(result.status).toBe('error');
    expect(result.denyReason).toBe('WRISTBAND_NOT_FOUND');
  });
});

describe('topUpWristband', () => {
  it('dobije kredit na náramku', async () => {
    const db = makeDb(
      [[makeWristbandRow({ balance_hellers: 100000 })], [makeTapRow({ tap_type: 'top_up' })]],
      vi.fn(), // execute for top_up insert
    );

    const result = await topUpWristband('A1B2C3D4', 50000, 'card', 'terminal-001', 'pi_test', null, db);

    expect(result.balanceHellers).toBe(100000);
  });

  it('vyhodí VALIDATION_ERROR pro nulový top-up', async () => {
    const db = makeDb([]);

    await expect(topUpWristband('A1B2C3D4', 0, 'cash', 'terminal-001', null, null, db))
      .rejects.toThrow('VALIDATION_ERROR');
  });
});

describe('debitWristband', () => {
  it('odečte platbu z náramku', async () => {
    const db = makeDb([
      [makeWristbandRow({ balance_hellers: 30000 })],  // UPDATE returning new balance
      [makeTapRow({ tap_type: 'payment', amount_hellers: -20000, balance_after_hellers: 30000 })],
    ]);

    const result = await debitWristband('A1B2C3D4', 20000, 'bar-3', 'Main Bar', db);

    expect(result.tapType).toBe('payment');
    expect(result.status).toBe('ok');
  });

  it('zamítne platbu při nedostatečném zůstatku', async () => {
    // UPDATE returns empty (insufficient balance check failed)
    const db = makeDb([
      [],                                    // UPDATE returns nothing
      [makeWristbandRow({ balance_hellers: 5000 })],  // SELECT for existing wristband
      [makeTapRow({ status: 'denied', deny_reason: 'INSUFFICIENT_BALANCE' })],  // denied tap
    ]);

    const result = await debitWristband('A1B2C3D4', 20000, 'bar-3', 'Main Bar', db);

    expect(result.status).toBe('denied');
    expect(result.denyReason).toBe('INSUFFICIENT_BALANCE');
  });

  it('vyhodí VALIDATION_ERROR pro nulový debit', async () => {
    const db = makeDb([]);

    await expect(debitWristband('A1B2C3D4', 0, 'bar-3', null, db))
      .rejects.toThrow('VALIDATION_ERROR');
  });
});

describe('getWristbandBalance', () => {
  it('vrátí aktuální zůstatek', async () => {
    const db = makeDb([[{ balance_hellers: 75000 }]]);

    const result = await getWristbandBalance('A1B2C3D4', db);

    expect(result).not.toBeNull();
    expect(result?.balanceHellers).toBe(75000);
  });

  it('vrátí null pro neexistující náramek', async () => {
    const db = makeDb([[]]); // empty

    const result = await getWristbandBalance('UNKNOWN', db);

    expect(result).toBeNull();
  });
});
