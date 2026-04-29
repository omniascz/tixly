/**
 * Feature #170 — Resale co-mingling on seat map
 *
 * Tests for getCombinedSeatAvailability, getResaleListingsForSection, and
 * getPrimaryAvailability.
 *
 * Run: vitest src/__tests__/seat-comingle.test.ts
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  getCombinedSeatAvailability,
  getResaleListingsForSection,
  getPrimaryAvailability,
} from '../services/seat-comingle.service.js';
import type { DbAdapter } from '../types/resale.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeDb(queryImpl: (sql: string, params?: unknown[]) => Promise<unknown[]>): DbAdapter {
  return {
    query: vi.fn().mockImplementation(queryImpl),
    execute: vi.fn().mockResolvedValue(undefined),
    transaction: vi.fn(),
  } as unknown as DbAdapter;
}

function primaryRow(overrides: Record<string, unknown> = {}) {
  return {
    seat_id: 'seat-1',
    section: 'A',
    row: '1',
    number: '1',
    price_czk: '500',
    is_available: true,
    ...overrides,
  };
}

function resaleRow(overrides: Record<string, unknown> = {}) {
  return {
    listing_id: 'listing-1',
    seat_id: 'seat-1',
    section: 'A',
    row: '1',
    seat_number: '1',
    asking_price_czk: '600',
    status: 'active',
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// getPrimaryAvailability
// ---------------------------------------------------------------------------

describe('getPrimaryAvailability', () => {
  it('returns empty array when no primary seats exist', async () => {
    const db = makeDb(async () => []);
    const result = await getPrimaryAvailability('event-1', 'A', db);
    expect(result).toEqual([]);
  });

  it('maps DB rows to PrimarySeats correctly', async () => {
    const db = makeDb(async () => [primaryRow({ seat_id: 'seat-42', price_czk: '750', is_available: false })]);
    const result = await getPrimaryAvailability('event-1', 'A', db);
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({
      seatId: 'seat-42',
      priceCzk: 750,
      isAvailable: false,
    });
  });

  it('passes correct SQL params (eventId and section)', async () => {
    const queryFn = vi.fn().mockResolvedValue([]);
    const db = { query: queryFn, execute: vi.fn(), transaction: vi.fn() } as unknown as DbAdapter;
    await getPrimaryAvailability('event-99', 'B', db);
    expect(queryFn).toHaveBeenCalledWith(expect.stringContaining('event_seats'), ['event-99', 'B']);
  });
});

// ---------------------------------------------------------------------------
// getResaleListingsForSection
// ---------------------------------------------------------------------------

describe('getResaleListingsForSection', () => {
  it('returns empty array when no active resale listings exist', async () => {
    const db = makeDb(async () => []);
    const result = await getResaleListingsForSection('event-1', 'A', db);
    expect(result).toEqual([]);
  });

  it('maps DB rows to ResaleListing correctly', async () => {
    const db = makeDb(async () => [resaleRow({ listing_id: 'lst-7', asking_price_czk: '1200' })]);
    const result = await getResaleListingsForSection('event-1', 'A', db);
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({
      listingId: 'lst-7',
      askingPriceCzk: 1200,
      status: 'active',
    });
  });

  it('passes correct SQL params including status=active filter', async () => {
    const queryFn = vi.fn().mockResolvedValue([]);
    const db = { query: queryFn, execute: vi.fn(), transaction: vi.fn() } as unknown as DbAdapter;
    await getResaleListingsForSection('event-42', 'C', db);
    expect(queryFn).toHaveBeenCalledWith(
      expect.stringContaining("status='active'"),
      ['event-42', 'C'],
    );
  });
});

// ---------------------------------------------------------------------------
// getCombinedSeatAvailability — empty section
// ---------------------------------------------------------------------------

describe('getCombinedSeatAvailability — empty section', () => {
  it('returns zero counts when section has no seats at all', async () => {
    const db = makeDb(async () => []);
    const summary = await getCombinedSeatAvailability('event-1', 'A', { db });

    expect(summary.totalSeats).toBe(0);
    expect(summary.primaryAvailable).toBe(0);
    expect(summary.resaleAvailable).toBe(0);
    expect(summary.combinedAvailable).toBe(0);
    expect(summary.seats).toEqual([]);
  });

  it('echoes back eventId and section', async () => {
    const db = makeDb(async () => []);
    const summary = await getCombinedSeatAvailability('event-xyz', 'VIP', { db });
    expect(summary.eventId).toBe('event-xyz');
    expect(summary.section).toBe('VIP');
  });
});

// ---------------------------------------------------------------------------
// getCombinedSeatAvailability — primary-only seats
// ---------------------------------------------------------------------------

describe('getCombinedSeatAvailability — primary-only seats', () => {
  function makeDbPrimaryOnly(seats: ReturnType<typeof primaryRow>[]) {
    return makeDb(async (sql) => {
      if (sql.includes('event_seats')) return seats;
      return []; // no resale listings
    });
  }

  it('marks available primary seats correctly', async () => {
    const db = makeDbPrimaryOnly([primaryRow({ seat_id: 's1', is_available: true })]);
    const summary = await getCombinedSeatAvailability('event-1', 'A', { db });

    expect(summary.primaryAvailable).toBe(1);
    expect(summary.resaleAvailable).toBe(0);
    expect(summary.combinedAvailable).toBe(1);
    const seat = summary.seats[0];
    expect(seat.availabilityType).toBe('primary');
    expect(seat.isAvailable).toBe(true);
    expect(seat.listingId).toBeNull();
    expect(seat.resalePriceCzk).toBeNull();
  });

  it('marks unavailable primary seats as not available', async () => {
    const db = makeDbPrimaryOnly([primaryRow({ seat_id: 's1', is_available: false })]);
    const summary = await getCombinedSeatAvailability('event-1', 'A', { db });

    expect(summary.primaryAvailable).toBe(0);
    expect(summary.combinedAvailable).toBe(0);
    const seat = summary.seats[0];
    expect(seat.isAvailable).toBe(false);
  });

  it('counts multiple available primary seats correctly', async () => {
    const db = makeDbPrimaryOnly([
      primaryRow({ seat_id: 's1', is_available: true }),
      primaryRow({ seat_id: 's2', is_available: true }),
      primaryRow({ seat_id: 's3', is_available: false }),
    ]);
    const summary = await getCombinedSeatAvailability('event-1', 'A', { db });

    expect(summary.totalSeats).toBe(3);
    expect(summary.primaryAvailable).toBe(2);
    expect(summary.combinedAvailable).toBe(2);
  });
});

// ---------------------------------------------------------------------------
// getCombinedSeatAvailability — resale-only seats
// ---------------------------------------------------------------------------

describe('getCombinedSeatAvailability — resale-only seats', () => {
  function makeDbResaleOnly(listings: ReturnType<typeof resaleRow>[]) {
    return makeDb(async (sql) => {
      if (sql.includes('resale_listings')) return listings;
      return []; // no primary seats
    });
  }

  it('marks resale-only seats as resale type', async () => {
    const db = makeDbResaleOnly([resaleRow({ seat_id: 's1', listing_id: 'lst-1', asking_price_czk: '800' })]);
    const summary = await getCombinedSeatAvailability('event-1', 'A', { db });

    expect(summary.resaleAvailable).toBe(1);
    expect(summary.primaryAvailable).toBe(0);
    expect(summary.combinedAvailable).toBe(1);
    const seat = summary.seats[0];
    expect(seat.availabilityType).toBe('resale');
    expect(seat.isAvailable).toBe(true);
    expect(seat.listingId).toBe('lst-1');
    expect(seat.resalePriceCzk).toBe(800);
    expect(seat.primaryPriceCzk).toBeNull();
  });

  it('counts multiple resale-only seats correctly', async () => {
    const db = makeDbResaleOnly([
      resaleRow({ seat_id: 's1', listing_id: 'lst-1' }),
      resaleRow({ seat_id: 's2', listing_id: 'lst-2' }),
    ]);
    const summary = await getCombinedSeatAvailability('event-1', 'A', { db });
    expect(summary.totalSeats).toBe(2);
    expect(summary.resaleAvailable).toBe(2);
  });
});

// ---------------------------------------------------------------------------
// getCombinedSeatAvailability — mixed section
// ---------------------------------------------------------------------------

describe('getCombinedSeatAvailability — mixed section', () => {
  it('correctly merges primary and resale seats from different seat ids', async () => {
    const db = makeDb(async (sql) => {
      if (sql.includes('event_seats')) {
        return [
          primaryRow({ seat_id: 'p1', number: '1', is_available: true }),
          primaryRow({ seat_id: 'p2', number: '2', is_available: false }),
        ];
      }
      // resale_listings
      return [
        resaleRow({ seat_id: 'r1', listing_id: 'lst-r1', seat_number: '10' }),
      ];
    });

    const summary = await getCombinedSeatAvailability('event-1', 'A', { db });

    expect(summary.totalSeats).toBe(3); // p1, p2, r1
    expect(summary.primaryAvailable).toBe(1); // p1
    expect(summary.resaleAvailable).toBe(1);  // r1
    expect(summary.combinedAvailable).toBe(2);
  });
});

// ---------------------------------------------------------------------------
// getCombinedSeatAvailability — seat in both primary and resale
// ---------------------------------------------------------------------------

describe('getCombinedSeatAvailability — seat in both primary and resale', () => {
  it('primary takes precedence when primary is available', async () => {
    const db = makeDb(async (sql) => {
      if (sql.includes('event_seats')) {
        return [primaryRow({ seat_id: 'shared', is_available: true, price_czk: '500' })];
      }
      return [resaleRow({ seat_id: 'shared', listing_id: 'lst-shared', asking_price_czk: '600' })];
    });

    const summary = await getCombinedSeatAvailability('event-1', 'A', { db });

    expect(summary.totalSeats).toBe(1);
    const seat = summary.seats[0];
    expect(seat.seatId).toBe('shared');
    expect(seat.availabilityType).toBe('primary');
    expect(seat.primaryPriceCzk).toBe(500);
    // Resale price is still surfaced for display purposes
    expect(seat.resalePriceCzk).toBe(600);
    expect(seat.listingId).toBe('lst-shared');
    expect(seat.isAvailable).toBe(true);
  });

  it('falls back to resale when primary seat is NOT available', async () => {
    const db = makeDb(async (sql) => {
      if (sql.includes('event_seats')) {
        return [primaryRow({ seat_id: 'shared', is_available: false, price_czk: '500' })];
      }
      return [resaleRow({ seat_id: 'shared', listing_id: 'lst-shared', asking_price_czk: '700' })];
    });

    const summary = await getCombinedSeatAvailability('event-1', 'A', { db });

    expect(summary.totalSeats).toBe(1);
    const seat = summary.seats[0];
    expect(seat.availabilityType).toBe('resale');
    expect(seat.isAvailable).toBe(true);
    expect(seat.resalePriceCzk).toBe(700);
    expect(seat.primaryPriceCzk).toBe(500); // face value still surfaced
    expect(seat.listingId).toBe('lst-shared');
  });

  it('combinedAvailable counts correctly for mixed dual-source section', async () => {
    // 3 seats: (a) primary available + resale listing → primary, (b) primary unavailable + resale → resale, (c) resale only
    const db = makeDb(async (sql) => {
      if (sql.includes('event_seats')) {
        return [
          primaryRow({ seat_id: 'a', is_available: true }),
          primaryRow({ seat_id: 'b', is_available: false }),
        ];
      }
      return [
        resaleRow({ seat_id: 'a', listing_id: 'lst-a' }),
        resaleRow({ seat_id: 'b', listing_id: 'lst-b' }),
        resaleRow({ seat_id: 'c', listing_id: 'lst-c' }),
      ];
    });

    const summary = await getCombinedSeatAvailability('event-1', 'A', { db });

    expect(summary.totalSeats).toBe(3);         // a, b, c
    expect(summary.primaryAvailable).toBe(1);   // a (primary)
    expect(summary.resaleAvailable).toBe(2);    // b (resale fallback) + c (resale only)
    expect(summary.combinedAvailable).toBe(3);
  });
});

// ---------------------------------------------------------------------------
// getCombinedSeatAvailability — section filtering
// ---------------------------------------------------------------------------

describe('getCombinedSeatAvailability — section filtering', () => {
  it('passes the correct section param to both DB queries', async () => {
    const queryFn = vi.fn().mockResolvedValue([]);
    const db = { query: queryFn, execute: vi.fn(), transaction: vi.fn() } as unknown as DbAdapter;

    await getCombinedSeatAvailability('event-1', 'FLOOR', { db });

    // Both calls should include 'FLOOR' as the section param
    const calls = queryFn.mock.calls;
    expect(calls).toHaveLength(2);
    for (const [, params] of calls) {
      expect(params).toContain('FLOOR');
    }
  });
});
