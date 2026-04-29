import { describe, it, expect, vi } from 'vitest';
import {
  requestUpgrade,
  confirmUpgrade,
  cancelUpgrade,
  getUpgradeRequest,
} from '../services/seat-upgrade.service.js';
import type { DbAdapter } from '../services/seat-upgrade.service.js';

function makeTicketRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'ticket-001',
    owner_id: 'user-001',
    event_id: 'event-001',
    original_price: 50000,
    status: 'active',
    ...overrides,
  };
}

function makeUpgradeRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'upg-001',
    original_ticket_id: 'ticket-001',
    new_seat_id: 'seat-VIP-1',
    new_ticket_type_id: null,
    user_id: 'user-001',
    event_id: 'event-001',
    original_price_hellers: 50000,
    new_price_hellers: 150000,
    upgrade_fee_hellers: 100000,
    status: 'pending',
    payment_intent_id: null,
    new_ticket_id: null,
    expires_at: '2026-04-14T10:10:00Z',
    created_at: '2026-04-14T10:00:00Z',
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

describe('requestUpgrade', () => {
  it('vytvoří žádost o upgrade sedadla', async () => {
    const db = makeDb([
      [makeTicketRow()],        // ticket lookup
      [makeUpgradeRow()],       // INSERT upgrade
    ]);

    const result = await requestUpgrade('ticket-001', 'user-001', 'seat-VIP-1', 150000, db);

    expect(result.upgradeFeeHellers).toBe(100000);
    expect(result.newSeatId).toBe('seat-VIP-1');
    expect(result.status).toBe('pending');
  });

  it('vyhodí TICKET_NOT_FOUND pro neexistující vstupenku', async () => {
    const db = makeDb([[]]); // empty ticket result

    await expect(requestUpgrade('nonexistent', 'user-001', 'seat-VIP-1', 150000, db))
      .rejects.toThrow('TICKET_NOT_FOUND');
  });

  it('vyhodí TICKET_OWNERSHIP_DENIED pro cizí vstupenku', async () => {
    const db = makeDb([[makeTicketRow({ owner_id: 'other-user' })]]);

    await expect(requestUpgrade('ticket-001', 'user-001', 'seat-VIP-1', 150000, db))
      .rejects.toThrow('TICKET_OWNERSHIP_DENIED');
  });

  it('vyhodí VALIDATION_ERROR pro downgrade (nižší cena)', async () => {
    const db = makeDb([[makeTicketRow({ original_price: 100000 })]]);

    // new price 50000 < original 100000 → not an upgrade
    await expect(requestUpgrade('ticket-001', 'user-001', 'seat-B5', 50000, db))
      .rejects.toThrow('VALIDATION_ERROR');
  });

  it('vyhodí TICKET_NOT_ACTIVE pro neplatnou vstupenku', async () => {
    const db = makeDb([[makeTicketRow({ status: 'cancelled' })]]);

    await expect(requestUpgrade('ticket-001', 'user-001', 'seat-VIP-1', 150000, db))
      .rejects.toThrow('TICKET_NOT_ACTIVE');
  });
});

describe('confirmUpgrade', () => {
  it('potvrdí upgrade po platbě', async () => {
    const db = makeDb([[makeUpgradeRow({ status: 'completed', payment_intent_id: 'pi_test', new_ticket_id: 'ticket-002', completed_at: '2026-04-14T10:05:00Z' })]]);

    const result = await confirmUpgrade('upg-001', 'pi_test', 'ticket-002', db);

    expect(result.status).toBe('completed');
    expect(result.paymentIntentId).toBe('pi_test');
    expect(result.newTicketId).toBe('ticket-002');
  });

  it('vyhodí UPGRADE_NOT_FOUND pro expirovaný upgrade', async () => {
    const db = makeDb([[]]); // empty = expired or not found

    await expect(confirmUpgrade('upg-001', 'pi_test', 'ticket-002', db))
      .rejects.toThrow('UPGRADE_NOT_FOUND');
  });
});

describe('cancelUpgrade', () => {
  it('zruší žádost o upgrade', async () => {
    const db = makeDb([[makeUpgradeRow({ status: 'cancelled' })]]);

    const result = await cancelUpgrade('upg-001', 'user-001', db);

    expect(result.status).toBe('cancelled');
  });

  it('vyhodí UPGRADE_NOT_FOUND pro dokončený upgrade', async () => {
    const db = makeDb([[]]); // empty = already completed

    await expect(cancelUpgrade('upg-001', 'user-001', db))
      .rejects.toThrow('UPGRADE_NOT_FOUND');
  });
});

describe('getUpgradeRequest', () => {
  it('vrátí žádost o upgrade', async () => {
    const db = makeDb([[makeUpgradeRow()]]);

    const result = await getUpgradeRequest('upg-001', db);

    expect(result).not.toBeNull();
    expect(result?.upgradeFeeHellers).toBe(100000);
  });

  it('vrátí null pro neexistující žádost', async () => {
    const db = makeDb([[]]); // empty

    const result = await getUpgradeRequest('nonexistent', db);

    expect(result).toBeNull();
  });
});
