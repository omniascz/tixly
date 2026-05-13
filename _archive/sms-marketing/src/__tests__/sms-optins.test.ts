import { describe, it, expect, vi } from 'vitest';
import {
  createOptIn,
  getPendingSyncOptIns,
  markSynced,
  getOptInStats,
} from '../services/sms-optins.service.js';
import type { DbAdapter } from '../services/sms-optins.service.js';

const ORDER_ID = 'order-001';
const BUYER_ID = 'buyer-001';
const EVENT_ID = 'event-001';
const OPTIN_ID = 'optin-001';

function makeOptInRow(overrides: Record<string, unknown> = {}) {
  return {
    id: OPTIN_ID,
    order_id: ORDER_ID,
    buyer_id: BUYER_ID,
    event_id: EVENT_ID,
    phone_number: '+420722123456',
    language: 'cs',
    opted: true,
    opted_at: '2026-04-14T10:30:00Z',
    synced: false,
    synced_at: null,
    created_at: '2026-04-14T10:00:00Z',
    updated_at: '2026-04-14T10:00:00Z',
    ...overrides,
  };
}

function makeDb(queryResults: unknown[][] = []): DbAdapter {
  let callIdx = 0;
  return {
    query: vi.fn(async () => {
      const result = queryResults[callIdx] ?? [];
      callIdx++;
      return result;
    }),
    execute: vi.fn(),
    transaction: vi.fn(async (fn) => fn({
      query: vi.fn().mockResolvedValue([]),
      execute: vi.fn(),
      transaction: vi.fn(),
    } as DbAdapter)),
  };
}

describe('createOptIn', () => {
  it('vytvoří opt-in záznam s normalizovaným telefonním číslem', async () => {
    const db = makeDb([[makeOptInRow({ phone_number: '+420722123456' })]]);

    const result = await createOptIn({
      orderId: ORDER_ID,
      buyerId: BUYER_ID,
      eventId: EVENT_ID,
      phoneNumber: '722 123 456',  // neformální vstup
      language: 'cs',
    }, true, db);

    expect(result.phoneNumber).toBe('+420722123456');
    expect(result.opted).toBe(true);
    expect(result.optedAt).toBe('2026-04-14T10:30:00Z');
  });

  it('normalizuje CZ čísla na +420 prefix', async () => {
    const db = makeDb([[makeOptInRow()]]);

    await createOptIn({
      orderId: ORDER_ID,
      buyerId: BUYER_ID,
      eventId: EVENT_ID,
      phoneNumber: '702123456',
      language: 'en',
    }, false, db);

    // Kontrola že se normalizovalo — phone je v params, ne v SQL
    const params = (db.query as ReturnType<typeof vi.fn>).mock.calls[0][1] as unknown[];
    expect(params).toContain('+420702123456');
  });

  it('je upsert — pokud order existuje, aktualizuje', async () => {
    const db = makeDb([[makeOptInRow()]]);

    await createOptIn({
      orderId: ORDER_ID,
      buyerId: BUYER_ID,
      eventId: EVENT_ID,
      phoneNumber: '+420722999999',
      language: 'cs',
    }, true, db);

    const sql = (db.query as ReturnType<typeof vi.fn>).mock.calls[0][0] as string;
    expect(sql).toContain('ON CONFLICT');
  });
});

describe('getPendingSyncOptIns', () => {
  it('vrátí opt-ins připravené k sync (opted=true, synced=false)', async () => {
    const db = makeDb([[
      makeOptInRow({ opted: true, synced: false }),
      makeOptInRow({ id: 'optin-2', opted: true, synced: false }),
    ]]);

    const result = await getPendingSyncOptIns(db);

    expect(result).toHaveLength(2);
    expect(result.every(o => o.opted && !o.synced)).toBe(true);
    const sql = (db.query as ReturnType<typeof vi.fn>).mock.calls[0][0] as string;
    expect(sql).toContain('opted = true AND synced = false');
  });
});

describe('markSynced', () => {
  it('markuje opt-in jako synchronizovaný (synced=true, synced_at=NOW)', async () => {
    const db = makeDb([[makeOptInRow({ synced: true, synced_at: '2026-04-14T11:00:00Z' })]]);

    const result = await markSynced(OPTIN_ID, db);

    expect(result.synced).toBe(true);
    expect(result.syncedAt).toBe('2026-04-14T11:00:00Z');
  });
});

describe('getOptInStats', () => {
  it('vrátí opt-in rate pro event (procento kupujících, kteří se přihlásili)', async () => {
    const db = makeDb([[{ total: 100, opted: 45 }]]);

    const result = await getOptInStats(EVENT_ID, db);

    expect(result.total).toBe(100);
    expect(result.opted).toBe(45);
    expect(result.optInRate).toBe(45);
  });

  it('vrátí 0 pokud je total nula', async () => {
    const db = makeDb([[{ total: 0, opted: 0 }]]);

    const result = await getOptInStats(EVENT_ID, db);

    expect(result.optInRate).toBe(0);
  });
});
