import { describe, it, expect, vi } from 'vitest';
import {
  holdSeat,
  killSeat,
  releaseHold,
  getActiveHolds,
  getSeatHoldStatus,
  bulkHoldSeats,
} from '../services/holds.service.js';
import type { DbAdapter } from '../services/holds.service.js';

function makeHoldRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'hold-001',
    event_id: 'event-001',
    seat_id: 'seat-A1',
    hold_type: 'hold',
    category: 'artist',
    label: 'Harry Styles guest list',
    held_by: 'staff-001',
    notes: null,
    released_at: null,
    created_at: '2026-04-14T10:00:00Z',
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

describe('holdSeat', () => {
  it('zarezervuje sedadlo pro umělce', async () => {
    const db = makeDb([
      [],                     // no existing hold
      [makeHoldRow()],        // INSERT
    ]);

    const result = await holdSeat('event-001', 'seat-A1', 'artist', 'staff-001', 'Harry Styles guest list', null, db);

    expect(result.seatId).toBe('seat-A1');
    expect(result.holdType).toBe('hold');
    expect(result.category).toBe('artist');
    expect(result.releasedAt).toBeNull();
  });

  it('vyhodí SEAT_ALREADY_HELD pokud sedadlo je již rezervováno', async () => {
    const db = makeDb([
      [makeHoldRow()],  // existing hold found
    ]);

    await expect(holdSeat('event-001', 'seat-A1', 'artist', 'staff-001', null, null, db))
      .rejects.toThrow('SEAT_ALREADY_HELD');
  });

  it('vyhodí VALIDATION_ERROR pro prázdné seatId', async () => {
    const db = makeDb([]);

    await expect(holdSeat('event-001', '', 'artist', 'staff-001', null, null, db))
      .rejects.toThrow('VALIDATION_ERROR');
  });
});

describe('killSeat', () => {
  it('trvale vyřadí sedadlo (kill)', async () => {
    const db = makeDb([
      [],                                      // no existing hold
      [makeHoldRow({ hold_type: 'kill', category: 'venue', label: 'Camera platform' })],
    ]);

    const result = await killSeat('event-001', 'seat-B5', 'venue', 'staff-001', 'Camera platform', null, db);

    expect(result.holdType).toBe('kill');
    expect(result.category).toBe('venue');
  });

  it('vyhodí SEAT_ALREADY_HELD pokud sedadlo je kill', async () => {
    const db = makeDb([
      [makeHoldRow({ hold_type: 'kill' })],  // existing kill found
    ]);

    await expect(killSeat('event-001', 'seat-B5', 'venue', 'staff-001', null, null, db))
      .rejects.toThrow('SEAT_ALREADY_HELD');
  });
});

describe('releaseHold', () => {
  it('uvolní hold a vrátí sedadlo do prodeje', async () => {
    const db = makeDb([[makeHoldRow({ released_at: '2026-04-14T12:00:00Z' })]]);

    const result = await releaseHold('hold-001', 'event-001', db);

    expect(result.releasedAt).toBeTruthy();
  });

  it('vyhodí HOLD_NOT_FOUND pro neexistující nebo kill hold', async () => {
    const db = makeDb([[]]); // no rows

    await expect(releaseHold('nonexistent', 'event-001', db))
      .rejects.toThrow('HOLD_NOT_FOUND');
  });
});

describe('getActiveHolds', () => {
  it('vrátí všechny aktivní holds a kills pro akci', async () => {
    const db = makeDb([[
      makeHoldRow({ id: 'hold-001', seat_id: 'seat-A1' }),
      makeHoldRow({ id: 'hold-002', seat_id: 'seat-A2', hold_type: 'kill', category: 'venue' }),
    ]]);

    const result = await getActiveHolds('event-001', db);

    expect(result).toHaveLength(2);
    expect(result[0].holdType).toBe('hold');
    expect(result[1].holdType).toBe('kill');
  });

  it('vrátí prázdný seznam bez aktivních holds', async () => {
    const db = makeDb([[]]); // empty

    const result = await getActiveHolds('event-001', db);

    expect(result).toHaveLength(0);
  });
});

describe('getSeatHoldStatus', () => {
  it('vrátí aktivní hold pro sedadlo', async () => {
    const db = makeDb([[makeHoldRow()]]);

    const result = await getSeatHoldStatus('event-001', 'seat-A1', db);

    expect(result).not.toBeNull();
    expect(result?.category).toBe('artist');
  });

  it('vrátí null pokud sedadlo není rezervováno', async () => {
    const db = makeDb([[]]); // empty

    const result = await getSeatHoldStatus('event-001', 'seat-free', db);

    expect(result).toBeNull();
  });
});

describe('bulkHoldSeats', () => {
  it('hromadně rezervuje blok sedadel', async () => {
    // For each seat: first query=check (empty), second=insert
    const db = makeDb([
      [],                                              // no existing for seat-A1
      [makeHoldRow({ seat_id: 'seat-A1' })],           // insert for seat-A1
      [],                                              // no existing for seat-A2
      [makeHoldRow({ id: 'hold-002', seat_id: 'seat-A2' })],  // insert for seat-A2
    ]);

    const result = await bulkHoldSeats('event-001', ['seat-A1', 'seat-A2'], 'sponsor', 'staff-001', 'Sponsor block', db);

    expect(result.held).toHaveLength(2);
    expect(result.failed).toHaveLength(0);
  });

  it('zaznamenává selhání pro již rezervovaná sedadla', async () => {
    const db = makeDb([
      [],                       // seat-A1: no existing
      [makeHoldRow()],          // seat-A1: inserted
      [makeHoldRow()],          // seat-A2: already held (throws)
    ]);

    const result = await bulkHoldSeats('event-001', ['seat-A1', 'seat-A2'], 'sponsor', 'staff-001', null, db);

    expect(result.held).toHaveLength(1);
    expect(result.failed).toHaveLength(1);
    expect(result.failed[0].seatId).toBe('seat-A2');
  });
});
