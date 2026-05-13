import { describe, it, expect, vi } from 'vitest';
import {
  initZoneOccupancy,
  recordEntry,
  recordExit,
  getEventOccupancy,
  getZoneOccupancy,
  grantZoneOverride,
  getTicketPassages,
  getZoneStats,
} from '../services/zone-capacity.service.js';
import type { DbAdapter } from '../services/zone-capacity.service.js';

function makeOccupancyRow(overrides: Record<string, unknown> = {}) {
  return {
    zone_id: 'zone-vip',
    event_id: 'event-001',
    current_count: 0,
    max_capacity: 100,
    last_updated_at: '2026-04-14T10:00:00Z',
    ...overrides,
  };
}

function makePassageRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'passage-001',
    ticket_id: 'ticket-001',
    zone_id: 'zone-vip',
    event_id: 'event-001',
    direction: 'entry',
    gate_id: 'gate-001',
    staff_id: null,
    scanned_at: '2026-04-14T14:00:00Z',
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

describe('initZoneOccupancy', () => {
  it('inicializuje occupancy pro seznam zón', async () => {
    const db = makeDb([
      [makeOccupancyRow({ zone_id: 'zone-vip', max_capacity: 50 })],
      [makeOccupancyRow({ zone_id: 'zone-general', max_capacity: 500 })],
    ]);

    const result = await initZoneOccupancy('event-001', [
      { zoneId: 'zone-vip', maxCapacity: 50 },
      { zoneId: 'zone-general', maxCapacity: 500 },
    ], db);

    expect(result).toHaveLength(2);
    expect(result[0].zoneId).toBe('zone-vip');
    expect(result[0].isFull).toBe(false);
  });

  it('nastaví maxCapacity na null pro neomezenou zónu', async () => {
    const db = makeDb([[makeOccupancyRow({ max_capacity: null })]]);
    const result = await initZoneOccupancy('event-001', [{ zoneId: 'zone-vip', maxCapacity: null }], db);
    expect(result[0].maxCapacity).toBeNull();
    expect(result[0].isFull).toBe(false);
  });
});

describe('recordEntry', () => {
  it('zaznamená vstup a vrátí passage + aktualizovanou occupancy', async () => {
    const updatedOccupancy = makeOccupancyRow({ current_count: 1 });
    const passageRow = makePassageRow({ direction: 'entry' });
    const db = makeDb([[updatedOccupancy], [passageRow]]);

    const result = await recordEntry('ticket-001', 'zone-vip', 'event-001', 'gate-001', null, db);

    expect(result).not.toBeNull();
    expect(result!.passage.direction).toBe('entry');
    expect(result!.occupancy.currentCount).toBe(1);
  });

  it('vrátí null pokud je zóna plná', async () => {
    const db = makeDb([[]]); // empty result = capacity check failed
    const result = await recordEntry('ticket-001', 'zone-vip', 'event-001', 'gate-001', null, db);
    expect(result).toBeNull();
  });

  it('isFull je true pokud currentCount >= maxCapacity', async () => {
    const fullOccupancy = makeOccupancyRow({ current_count: 100, max_capacity: 100 });
    const passageRow = makePassageRow();
    const db = makeDb([[fullOccupancy], [passageRow]]);

    const result = await recordEntry('ticket-001', 'zone-vip', 'event-001', 'gate-001', 'staff-001', db);
    expect(result!.occupancy.isFull).toBe(true);
  });

  it('předá staffId do db', async () => {
    const db = makeDb([[makeOccupancyRow({ current_count: 5 })], [makePassageRow()]]);
    await recordEntry('ticket-001', 'zone-vip', 'event-001', 'gate-001', 'staff-007', db);
    expect(db.query).toHaveBeenCalledTimes(2);
    // Second call inserts passage with staffId
    const insertCall = (db.query as ReturnType<typeof vi.fn>).mock.calls[1];
    expect(insertCall[1]).toContain('staff-007');
  });
});

describe('recordExit', () => {
  it('zaznamená výstup', async () => {
    const passageRow = makePassageRow({ direction: 'exit' });
    const db = makeDb([[passageRow]]);

    const result = await recordExit('ticket-001', 'zone-vip', 'event-001', 'gate-001', null, db);
    expect(result.direction).toBe('exit');
    expect(db.execute).toHaveBeenCalledOnce();
  });

  it('GREATEST zajistí že current_count neklesne pod 0', async () => {
    const passageRow = makePassageRow({ direction: 'exit' });
    const db = makeDb([[passageRow]]);

    await recordExit('ticket-001', 'zone-vip', 'event-001', 'gate-001', null, db);
    const sql = (db.execute as ReturnType<typeof vi.fn>).mock.calls[0][0] as string;
    expect(sql).toContain('GREATEST');
  });
});

describe('getEventOccupancy', () => {
  it('vrátí occupancy pro všechny zóny eventu', async () => {
    const db = makeDb([[
      makeOccupancyRow({ zone_id: 'zone-vip', current_count: 42 }),
      makeOccupancyRow({ zone_id: 'zone-general', current_count: 200 }),
    ]]);
    const result = await getEventOccupancy('event-001', db);
    expect(result).toHaveLength(2);
    expect(result[0].currentCount).toBe(42);
  });
});

describe('getZoneOccupancy', () => {
  it('vrátí occupancy pro konkrétní zónu', async () => {
    const db = makeDb([[makeOccupancyRow({ current_count: 15 })]]);
    const result = await getZoneOccupancy('zone-vip', 'event-001', db);
    expect(result).not.toBeNull();
    expect(result!.currentCount).toBe(15);
  });

  it('vrátí null pokud zóna neexistuje', async () => {
    const db = makeDb([[]]); // empty
    const result = await getZoneOccupancy('zone-missing', 'event-001', db);
    expect(result).toBeNull();
  });
});

describe('grantZoneOverride', () => {
  it('přidělí ticketu přístup do zóny', async () => {
    const db = makeDb([[{
      ticket_id: 'ticket-001',
      zone_id: 'zone-vip',
      event_id: 'event-001',
      granted_by: 'staff-001',
      granted_at: '2026-04-14T12:00:00Z',
      expires_at: null,
    }]]);

    const result = await grantZoneOverride('ticket-001', 'zone-vip', 'event-001', 'staff-001', null, db);
    expect(result.ticketId).toBe('ticket-001');
    expect(result.zoneId).toBe('zone-vip');
    expect(result.grantedBy).toBe('staff-001');
    expect(result.expiresAt).toBeNull();
  });
});

describe('getTicketPassages', () => {
  it('vrátí historii průchodů ticketu', async () => {
    const db = makeDb([[
      makePassageRow({ direction: 'entry', scanned_at: '2026-04-14T14:00:00Z' }),
      makePassageRow({ id: 'passage-002', direction: 'exit', scanned_at: '2026-04-14T22:00:00Z' }),
    ]]);

    const result = await getTicketPassages('ticket-001', db);
    expect(result).toHaveLength(2);
    expect(result[0].direction).toBe('entry');
    expect(result[1].direction).toBe('exit');
  });
});

describe('getZoneStats', () => {
  it('vrátí statistiky průchodů po zónách', async () => {
    const db = makeDb([[
      { zone_id: 'zone-vip', entries: '42', exits: '35' },
      { zone_id: 'zone-general', entries: '1200', exits: '980' },
    ]]);

    const result = await getZoneStats('event-001', db);
    expect(result).toHaveLength(2);
    expect(result[0]).toEqual({ zoneId: 'zone-vip', entries: 42, exits: 35, currentInside: 7 });
    expect(result[1].currentInside).toBe(220);
  });
});
