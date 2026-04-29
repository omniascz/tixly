import { describe, it, expect, vi } from 'vitest';
import {
  setEventTicketDefaults,
  getEventTicketDefaults,
  applyDefaults,
  deleteEventTicketDefaults,
} from '../services/event-ticket-defaults.service.js';
import type { DbAdapter, EventTicketDefaults } from '../services/event-ticket-defaults.service.js';

function makeDefaultsRow(overrides: Record<string, unknown> = {}) {
  return {
    event_id: 'event-001',
    promoter_id: 'promoter-001',
    min_age: 18,
    max_per_order: 8,
    inactive_message: 'Prodej skončil',
    sale_start_offset_minutes: null,
    sale_end_offset_minutes: 30,
    require_name: false,
    require_dob: false,
    transfer_allowed: true,
    resale_allowed: false,
    updated_at: '2026-04-14T10:00:00Z',
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

describe('setEventTicketDefaults', () => {
  it('uloží výchozí nastavení vstupenek pro event', async () => {
    const db = makeDb([[makeDefaultsRow()]]);
    const result = await setEventTicketDefaults({
      eventId: 'event-001',
      promoterId: 'promoter-001',
      minAge: 18,
      maxPerOrder: 8,
      inactiveMessage: 'Prodej skončil',
      resaleAllowed: false,
    }, db);

    expect(result.minAge).toBe(18);
    expect(result.maxPerOrder).toBe(8);
    expect(result.resaleAllowed).toBe(false);
    expect(result.transferAllowed).toBe(true); // default
  });

  it('odmítne minAge mimo rozsah', async () => {
    const db = makeDb();
    await expect(setEventTicketDefaults({
      eventId: 'e', promoterId: 'p', minAge: 150,
    }, db)).rejects.toThrow('minAge must be between 0 and 120');
  });

  it('odmítne záporné minAge', async () => {
    const db = makeDb();
    await expect(setEventTicketDefaults({
      eventId: 'e', promoterId: 'p', minAge: -1,
    }, db)).rejects.toThrow('minAge must be between 0 and 120');
  });

  it('odmítne maxPerOrder < 1', async () => {
    const db = makeDb();
    await expect(setEventTicketDefaults({
      eventId: 'e', promoterId: 'p', maxPerOrder: 0,
    }, db)).rejects.toThrow('maxPerOrder must be >= 1');
  });

  it('upsertuje — druhé volání přepíše hodnoty', async () => {
    const db = makeDb([[makeDefaultsRow({ min_age: 21 })]]);
    const result = await setEventTicketDefaults({
      eventId: 'event-001', promoterId: 'promoter-001', minAge: 21,
    }, db);
    expect(result.minAge).toBe(21);
    const sql = (db.query as ReturnType<typeof vi.fn>).mock.calls[0][0] as string;
    expect(sql).toContain('ON CONFLICT');
  });
});

describe('getEventTicketDefaults', () => {
  it('vrátí nastavení pokud existuje', async () => {
    const db = makeDb([[makeDefaultsRow()]]);
    const result = await getEventTicketDefaults('event-001', db);
    expect(result).not.toBeNull();
    expect(result!.minAge).toBe(18);
  });

  it('vrátí null pokud nastavení neexistuje', async () => {
    const db = makeDb([[]]); // empty
    const result = await getEventTicketDefaults('event-new', db);
    expect(result).toBeNull();
  });
});

describe('applyDefaults', () => {
  const defaults: EventTicketDefaults = {
    eventId: 'event-001',
    promoterId: 'promoter-001',
    minAge: 18,
    maxPerOrder: 8,
    inactiveMessage: 'Prodej skončil',
    saleStartOffsetMinutes: null,
    saleEndOffsetMinutes: 30,
    requireName: false,
    requireDob: false,
    transferAllowed: true,
    resaleAllowed: false,
    updatedAt: '2026-04-14T10:00:00Z',
  };

  it('doplní chybějící pole z defaults', () => {
    const input = { name: 'VIP vstupenka', price: 100000 };
    const result = applyDefaults(input, defaults);
    expect(result.minAge).toBe(18);
    expect(result.maxPerOrder).toBe(8);
    expect(result.name).toBe('VIP vstupenka'); // explicit fields preserved
  });

  it('explicitní hodnoty v inputu přebijí defaults', () => {
    const input = { name: 'Dětská', minAge: 0, maxPerOrder: 4 };
    const result = applyDefaults(input, defaults);
    expect(result.minAge).toBe(0);
    expect(result.maxPerOrder).toBe(4);
  });

  it('vrátí nezměněný input pokud defaults je null', () => {
    const input = { name: 'Vstupenka', price: 50000 };
    const result = applyDefaults(input, null);
    expect(result).toEqual(input);
  });
});

describe('deleteEventTicketDefaults', () => {
  it('smaže nastavení pro event', async () => {
    const db = makeDb([], vi.fn());
    await deleteEventTicketDefaults('event-001', 'promoter-001', db);
    expect(db.execute).toHaveBeenCalledOnce();
  });
});
