import { describe, it, expect, vi } from 'vitest';
import {
  createCompanionPair,
  getCompanionTicket,
  markSeatAccessible,
  getAccessibleSeats,
  requestAccommodation,
  getTicketAccommodations,
  verifyAccommodation,
  reserveAccessibleSeat,
  releaseAccessibleSeat,
} from '../services/accessibility.service.js';
import type { DbAdapter } from '../services/accessibility.service.js';

const EVENT_ID = 'event-001';
const PROMOTER_ID = 'promoter-001';
const PRIMARY_TICKET_ID = 'ticket-001';
const COMPANION_TICKET_ID = 'ticket-002';

function makeCompanionPairRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'pair-001',
    primary_ticket_id: PRIMARY_TICKET_ID,
    companion_ticket_id: COMPANION_TICKET_ID,
    relationship_type: 'assistant',
    created_at: '2026-04-14T10:00:00Z',
    ...overrides,
  };
}

function makeAccessibleSeatRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'seat-001',
    event_id: EVENT_ID,
    promoter_id: PROMOTER_ID,
    seat_id: 'A12',
    seat_section: 'Accessibility Section',
    accessibility_type: 'wheelchair_accessible',
    is_available: true,
    reserved_until: null,
    notes: 'Front row access',
    created_at: '2026-04-14T10:00:00Z',
    updated_at: '2026-04-14T10:00:00Z',
    ...overrides,
  };
}

function makeAccommodationRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'acc-001',
    ticket_id: PRIMARY_TICKET_ID,
    accommodation_type: 'wheelchair_access',
    additional_info: 'Need accessible entrance',
    verified: false,
    verified_at: null,
    created_at: '2026-04-14T10:00:00Z',
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
    transaction: vi.fn(async (fn) => fn({
      query: vi.fn().mockResolvedValue([]),
      execute: executeMock,
      transaction: vi.fn(),
    } as DbAdapter)),
  };
}

describe('createCompanionPair', () => {
  it('vytvoří párování companion vstupenky', async () => {
    const db = makeDb([[makeCompanionPairRow()]]);

    const result = await createCompanionPair(
      PRIMARY_TICKET_ID,
      COMPANION_TICKET_ID,
      'assistant',
      db,
    );

    expect(result.primaryTicketId).toBe(PRIMARY_TICKET_ID);
    expect(result.companionTicketId).toBe(COMPANION_TICKET_ID);
    expect(result.relationshipType).toBe('assistant');
  });

  it('vyhodí VALIDATION_ERROR bez ticket ID', async () => {
    const db = makeDb([]);

    await expect(
      createCompanionPair('', COMPANION_TICKET_ID, 'assistant', db),
    ).rejects.toThrow('VALIDATION_ERROR');
  });
});

describe('getCompanionTicket', () => {
  it('vrátí companion vstupenku pro primární vstupenku', async () => {
    const db = makeDb([[makeCompanionPairRow()]]);

    const result = await getCompanionTicket(PRIMARY_TICKET_ID, db);

    expect(result).not.toBeNull();
    expect(result?.companionTicketId).toBe(COMPANION_TICKET_ID);
  });

  it('vrátí null pokud žádná companion vstupenka neexistuje', async () => {
    const db = makeDb([[]]);

    const result = await getCompanionTicket('nonexistent', db);

    expect(result).toBeNull();
  });
});

describe('markSeatAccessible', () => {
  it('označí místo jako přístupné', async () => {
    const db = makeDb([[makeAccessibleSeatRow()]]);

    const result = await markSeatAccessible(
      EVENT_ID,
      PROMOTER_ID,
      'A12',
      'wheelchair_accessible',
      'Front row access',
      db,
    );

    expect(result.seatId).toBe('A12');
    expect(result.accessibilityType).toBe('wheelchair_accessible');
    expect(result.isAvailable).toBe(true);
  });

  it('vyhodí VALIDATION_ERROR bez seatId', async () => {
    const db = makeDb([]);

    await expect(
      markSeatAccessible(EVENT_ID, PROMOTER_ID, '', 'wheelchair_accessible', undefined, db),
    ).rejects.toThrow('VALIDATION_ERROR');
  });
});

describe('getAccessibleSeats', () => {
  it('vrátí všechna přístupná místa pro event', async () => {
    const db = makeDb([[
      makeAccessibleSeatRow({ seat_id: 'A12' }),
      makeAccessibleSeatRow({ seat_id: 'A13', id: 'seat-002' }),
    ]]);

    const result = await getAccessibleSeats(EVENT_ID, PROMOTER_ID, db);

    expect(result).toHaveLength(2);
    expect(result[0].seatId).toBe('A12');
  });

  it('filtruje přístupná místa podle typu', async () => {
    const db = makeDb([[makeAccessibleSeatRow()]]);

    const result = await getAccessibleSeats(
      EVENT_ID,
      PROMOTER_ID,
      db,
      'wheelchair_accessible',
    );

    expect(result[0].accessibilityType).toBe('wheelchair_accessible');
  });
});

describe('requestAccommodation', () => {
  it('vytvoří žádost o ubytování', async () => {
    const db = makeDb([[makeAccommodationRow()]]);

    const result = await requestAccommodation(
      PRIMARY_TICKET_ID,
      'wheelchair_access',
      'Need accessible entrance',
      db,
    );

    expect(result.ticketId).toBe(PRIMARY_TICKET_ID);
    expect(result.accommodationType).toBe('wheelchair_access');
    expect(result.verified).toBe(false);
  });

  it('vyhodí VALIDATION_ERROR bez typu', async () => {
    const db = makeDb([]);

    await expect(
      requestAccommodation(PRIMARY_TICKET_ID, '', undefined, db),
    ).rejects.toThrow('VALIDATION_ERROR');
  });
});

describe('getTicketAccommodations', () => {
  it('vrátí všechna ubytování pro vstupenku', async () => {
    const db = makeDb([[
      makeAccommodationRow({ accommodation_type: 'wheelchair_access' }),
      makeAccommodationRow({ id: 'acc-002', accommodation_type: 'deaf_support' }),
    ]]);

    const result = await getTicketAccommodations(PRIMARY_TICKET_ID, db);

    expect(result).toHaveLength(2);
    expect(result[0].accommodationType).toBe('wheelchair_access');
  });
});

describe('verifyAccommodation', () => {
  it('ověří ubytování (nastaví verified=true)', async () => {
    const db = makeDb([[makeAccommodationRow({ verified: true, verified_at: '2026-04-14T10:30:00Z' })]]);

    const result = await verifyAccommodation('acc-001', db);

    expect(result.verified).toBe(true);
    expect(result.verifiedAt).toBe('2026-04-14T10:30:00Z');
  });
});

describe('reserveAccessibleSeat', () => {
  it('rezervuje přístupné místo (označí jako nedostupné)', async () => {
    const executeMock = vi.fn().mockResolvedValue(undefined);
    const db = makeDb([], executeMock);
    const reservedUntil = new Date('2026-05-15');

    await reserveAccessibleSeat('A12', EVENT_ID, reservedUntil, db);

    expect(executeMock).toHaveBeenCalledTimes(1);
    const sql = executeMock.mock.calls[0][0] as string;
    expect(sql).toContain('is_available = false');
    expect(sql).toContain('reserved_until');
  });
});

describe('releaseAccessibleSeat', () => {
  it('uvolní rezervované přístupné místo', async () => {
    const executeMock = vi.fn().mockResolvedValue(undefined);
    const db = makeDb([], executeMock);

    await releaseAccessibleSeat('A12', EVENT_ID, db);

    expect(executeMock).toHaveBeenCalledTimes(1);
    const sql = executeMock.mock.calls[0][0] as string;
    expect(sql).toContain('is_available = true');
    expect(sql).toContain('reserved_until = NULL');
  });
});
