import { describe, it, expect, beforeEach, vi } from 'vitest';
import { NextRequest } from 'next/server';

// Services
import {
  createVenue,
  getVenue,
  listVenues,
  updateVenue,
  createZone,
  listZones,
  createTicketType,
  listTicketTypes,
} from '../services/venue.service';
import {
  createEntrySlot,
  getSlot,
  listSlots,
  getAvailableSlots,
  bulkCreateSlots,
  closeSlot,
  updateSlotCapacity,
} from '../services/slot.service';
import {
  createEntryBooking,
  getBooking,
  getBookingByRef,
  listBookingsForUser,
  cancelBooking,
  checkInByQR,
  listBookingsForSlot,
} from '../services/booking.service';

// API routes
import { GET as venuesGET, POST as venuesPOST } from '../app/api/entry/venues/route';
import { GET as venueGET, PATCH as venuePATCH } from '../app/api/entry/venues/[venueId]/route';
import { GET as zonesGET, POST as zonesPOST } from '../app/api/entry/venues/[venueId]/zones/route';
import { GET as ticketTypesGET, POST as ticketTypesPOST } from '../app/api/entry/venues/[venueId]/ticket-types/route';
import { GET as slotsGET, POST as slotsPOST } from '../app/api/entry/venues/[venueId]/slots/route';
import { POST as bookingsPOST } from '../app/api/entry/venues/[venueId]/bookings/route';
import { GET as bookingGET, PATCH as bookingPATCH } from '../app/api/entry/bookings/[bookingId]/route';
import { GET as bookingRefGET } from '../app/api/entry/bookings/ref/[bookingRef]/route';
import { POST as checkinPOST } from '../app/api/entry/checkin/route';

import { EntryError, isEntryError } from '../lib/entry-errors';

// ---------------------------------------------------------------------------
// makeDb helper
// ---------------------------------------------------------------------------

function makeDb(responses: unknown[][]) {
  let i = 0;
  return {
    query: vi.fn(async () => ({ rows: responses[i++] ?? [] })),
    execute: vi.fn(async () => {}),
  };
}

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const PROMOTER_ID = 'promoter-uuid-1';
const VENUE_ID = 'venue-uuid-1';
const ZONE_ID = 'zone-uuid-1';
const SLOT_ID = 'slot-uuid-1';
const BOOKING_ID = 'booking-uuid-1';
const USER_ID = 'user-uuid-1';
const QR_TOKEN = 'qr-token-uuid-1';

const venueRow = {
  id: VENUE_ID,
  promoter_id: PROMOTER_ID,
  name: 'Národní muzeum',
  venue_type: 'museum',
  address: 'Václavské náměstí 68',
  city: 'Praha',
  description: 'Hlavní budova',
  website_url: 'https://nm.cz',
  google_maps_url: null,
  accessibility_info: null,
  is_active: true,
  created_at: '2026-04-07T10:00:00Z',
};

const venueRowWithCounts = {
  ...venueRow,
  zone_count: 3,
  ticket_type_count: 4,
};

const zoneRow = {
  id: ZONE_ID,
  venue_id: VENUE_ID,
  name: 'Historická expozice',
  description: 'Hlavní část',
  capacity: 50,
  requires_separate_ticket: false,
  additional_price_hellers: 0,
  sort_order: 1,
  is_active: true,
};

const ticketTypeRow = {
  id: 'ticket-type-uuid-1',
  venue_id: VENUE_ID,
  name: 'Dospělý',
  price_hellers: 28000,
  age_min: 18,
  age_max: 999,
  max_per_booking: 10,
  requires_id: false,
  description: null,
  is_active: true,
  sort_order: 0,
};

const slotRow = {
  id: SLOT_ID,
  venue_id: VENUE_ID,
  slot_date: '2026-05-01',
  entry_time: '10:00',
  exit_time: '12:00',
  capacity: 100,
  booked_count: 20,
  status: 'available',
  notes: null,
};

const bookingRow = {
  id: BOOKING_ID,
  entry_slot_id: SLOT_ID,
  user_id: USER_ID,
  promoter_id: PROMOTER_ID,
  order_id: null,
  booking_ref: 'MUS-20260501-123456',
  ticket_lines: [
    { ticketTypeId: 'tt-1', name: 'Dospělý', quantity: 2, unitPriceHellers: 28000, totalHellers: 56000 },
  ],
  total_visitors: 2,
  total_hellers: 56000,
  status: 'confirmed',
  qr_token: QR_TOKEN,
  checked_in_at: null,
  notes: null,
  created_at: '2026-04-07T10:00:00Z',
};

// ---------------------------------------------------------------------------
// Helper: make NextRequest
// ---------------------------------------------------------------------------

function makeRequest(method: string, url: string, body?: unknown): NextRequest {
  const init: RequestInit = { method };
  if (body !== undefined) {
    init.body = JSON.stringify(body);
    init.headers = { 'Content-Type': 'application/json' };
  }
  return new NextRequest(url, init);
}

// ===========================================================================
// 1. EntryError
// ===========================================================================

describe('EntryError', () => {
  it('has correct code and statusCode', () => {
    const err = new EntryError('VENUE_NOT_FOUND');
    expect(err.code).toBe('VENUE_NOT_FOUND');
    expect(err.statusCode).toBe(404);
    expect(err.name).toBe('EntryError');
  });

  it('toHttpError returns structured object', () => {
    const err = new EntryError('SLOT_FULL');
    const obj = err.toHttpError();
    expect(obj.statusCode).toBe(409);
    expect(obj.error).toBe('SLOT_FULL');
  });

  it('isEntryError identifies instances', () => {
    expect(isEntryError(new EntryError('BOOKING_NOT_FOUND'))).toBe(true);
    expect(isEntryError(new Error('other'))).toBe(false);
  });
});

// ===========================================================================
// 2. createVenue
// ===========================================================================

describe('createVenue', () => {
  it('returns mapped venue on success', async () => {
    const db = makeDb([[venueRow]]);
    const venue = await createVenue(PROMOTER_ID, {
      name: 'Národní muzeum',
      venueType: 'museum',
      city: 'Praha',
      address: 'Václavské náměstí 68',
    }, db);

    expect(venue.id).toBe(VENUE_ID);
    expect(venue.venueType).toBe('museum');
    expect(venue.city).toBe('Praha');
    expect(db.query).toHaveBeenCalledTimes(1);
  });

  it('throws VENUE_DUPLICATE when no row returned', async () => {
    const db = makeDb([[]]); // empty rows
    await expect(
      createVenue(PROMOTER_ID, { name: 'Dup', venueType: 'zoo' }, db),
    ).rejects.toMatchObject({ code: 'VENUE_DUPLICATE' });
  });

  it('passes correct params to INSERT', async () => {
    const db = makeDb([[venueRow]]);
    await createVenue(PROMOTER_ID, {
      name: 'Národní muzeum',
      venueType: 'museum',
      websiteUrl: 'https://nm.cz',
    }, db);
    const params = db.query.mock.calls[0][1] as unknown[];
    expect(params[0]).toBe(PROMOTER_ID);
    expect(params[1]).toBe('Národní muzeum');
    expect(params[2]).toBe('museum');
    expect(params[6]).toBe('https://nm.cz');
  });
});

// ===========================================================================
// 3. getVenue
// ===========================================================================

describe('getVenue', () => {
  it('returns venue with zone/ticketType counts', async () => {
    const db = makeDb([[venueRowWithCounts]]);
    const venue = await getVenue(VENUE_ID, db);
    expect(venue.id).toBe(VENUE_ID);
    expect(venue.zoneCount).toBe(3);
    expect(venue.ticketTypeCount).toBe(4);
  });

  it('throws VENUE_NOT_FOUND for unknown id', async () => {
    const db = makeDb([[]]); // no rows
    await expect(getVenue('no-such-id', db)).rejects.toMatchObject({ code: 'VENUE_NOT_FOUND' });
  });
});

// ===========================================================================
// 4. listVenues
// ===========================================================================

describe('listVenues', () => {
  it('returns all active venues for promoter', async () => {
    const db = makeDb([[venueRow, { ...venueRow, id: 'v2', name: 'Zoo Praha', venue_type: 'zoo' }]]);
    const venues = await listVenues(PROMOTER_ID, {}, db);
    expect(venues).toHaveLength(2);
  });

  it('filters by venue_type', async () => {
    const db = makeDb([[venueRow]]);
    const venues = await listVenues(PROMOTER_ID, { venueType: 'museum' }, db);
    expect(venues).toHaveLength(1);
    const sql = db.query.mock.calls[0][0] as string;
    expect(sql).toContain('venue_type');
  });

  it('filters by city', async () => {
    const db = makeDb([[venueRow]]);
    const venues = await listVenues(PROMOTER_ID, { city: 'Praha' }, db);
    expect(venues).toHaveLength(1);
    const params = db.query.mock.calls[0][1] as unknown[];
    expect(params).toContain('Praha');
  });

  it('returns empty array when no venues', async () => {
    const db = makeDb([[]]);
    const venues = await listVenues(PROMOTER_ID, {}, db);
    expect(venues).toEqual([]);
  });
});

// ===========================================================================
// 5. updateVenue
// ===========================================================================

describe('updateVenue', () => {
  it('updates and returns venue', async () => {
    const updated = { ...venueRow, city: 'Brno' };
    const db = makeDb([[updated]]);
    const venue = await updateVenue(VENUE_ID, { city: 'Brno' }, db);
    expect(venue.city).toBe('Brno');
  });

  it('throws VENUE_NOT_FOUND when not found', async () => {
    const db = makeDb([[]]); // no row returned
    await expect(updateVenue('bad-id', { name: 'X' }, db)).rejects.toMatchObject({ code: 'VENUE_NOT_FOUND' });
  });
});

// ===========================================================================
// 6. createZone
// ===========================================================================

describe('createZone', () => {
  it('returns mapped zone', async () => {
    const db = makeDb([[zoneRow]]);
    const zone = await createZone(VENUE_ID, {
      name: 'Historická expozice',
      capacity: 50,
      sortOrder: 1,
    }, db);
    expect(zone.id).toBe(ZONE_ID);
    expect(zone.additionalPriceHellers).toBe(0);
    expect(zone.requiresSeparateTicket).toBe(false);
  });

  it('throws ZONE_DUPLICATE when empty rows', async () => {
    const db = makeDb([[]]); // conflict
    await expect(
      createZone(VENUE_ID, { name: 'Dup', capacity: 10 }, db),
    ).rejects.toMatchObject({ code: 'ZONE_DUPLICATE' });
  });

  it('stores additionalPriceHellers in halíře', async () => {
    const zoneWithPrice = { ...zoneRow, additional_price_hellers: 5000 };
    const db = makeDb([[zoneWithPrice]]);
    const zone = await createZone(VENUE_ID, {
      name: 'Premium',
      capacity: 20,
      additionalPriceHellers: 5000,
    }, db);
    expect(zone.additionalPriceHellers).toBe(5000);
  });
});

// ===========================================================================
// 7. listZones
// ===========================================================================

describe('listZones', () => {
  it('returns ordered zones', async () => {
    const z1 = { ...zoneRow, sort_order: 0 };
    const z2 = { ...zoneRow, id: 'z2', name: 'Moderní expozice', sort_order: 1 };
    const db = makeDb([[z1, z2]]);
    const zones = await listZones(VENUE_ID, db);
    expect(zones).toHaveLength(2);
    const sql = db.query.mock.calls[0][0] as string;
    expect(sql).toContain('ORDER BY sort_order');
  });

  it('returns empty array when no zones', async () => {
    const db = makeDb([[]]);
    const zones = await listZones(VENUE_ID, db);
    expect(zones).toEqual([]);
  });
});

// ===========================================================================
// 8. createTicketType
// ===========================================================================

describe('createTicketType', () => {
  it('returns mapped ticket type with price in halíře', async () => {
    const db = makeDb([[ticketTypeRow]]);
    const tt = await createTicketType(VENUE_ID, {
      name: 'Dospělý',
      priceHellers: 28000,
      ageMin: 18,
    }, db);
    expect(tt.priceHellers).toBe(28000);
    expect(tt.ageMin).toBe(18);
    expect(tt.ageMax).toBe(999);
    expect(tt.maxPerBooking).toBe(10);
  });

  it('throws VENUE_NOT_FOUND when insert fails', async () => {
    const db = makeDb([[]]); // no row
    await expect(
      createTicketType(VENUE_ID, { name: 'X', priceHellers: 1000 }, db),
    ).rejects.toMatchObject({ code: 'VENUE_NOT_FOUND' });
  });
});

// ===========================================================================
// 9. listTicketTypes
// ===========================================================================

describe('listTicketTypes', () => {
  it('returns ticket types ordered by sort_order', async () => {
    const tt2 = { ...ticketTypeRow, id: 'tt-2', name: 'Dítě', price_hellers: 14000, sort_order: 1 };
    const db = makeDb([[ticketTypeRow, tt2]]);
    const tts = await listTicketTypes(VENUE_ID, db);
    expect(tts).toHaveLength(2);
    expect(tts[1].priceHellers).toBe(14000);
  });
});

// ===========================================================================
// 10. createEntrySlot
// ===========================================================================

describe('createEntrySlot', () => {
  it('creates and returns slot', async () => {
    const db = makeDb([[slotRow]]);
    const slot = await createEntrySlot(VENUE_ID, {
      slotDate: '2026-05-01',
      entryTime: '10:00',
      exitTime: '12:00',
      capacity: 100,
    }, db);
    expect(slot.id).toBe(SLOT_ID);
    expect(slot.capacity).toBe(100);
    expect(slot.status).toBe('available');
    expect(db.query).toHaveBeenCalledOnce();
  });

  it('throws SLOT_NOT_FOUND when empty rows', async () => {
    const db = makeDb([[]]); // conflict / not found
    await expect(
      createEntrySlot(VENUE_ID, { slotDate: '2026-05-01', entryTime: '10:00', exitTime: '12:00', capacity: 50 }, db),
    ).rejects.toMatchObject({ code: 'SLOT_NOT_FOUND' });
  });
});

// ===========================================================================
// 11. getSlot
// ===========================================================================

describe('getSlot', () => {
  it('returns slot by id', async () => {
    const db = makeDb([[slotRow]]);
    const slot = await getSlot(SLOT_ID, db);
    expect(slot.slotDate).toBe('2026-05-01');
    expect(slot.bookedCount).toBe(20);
  });

  it('throws SLOT_NOT_FOUND for unknown id', async () => {
    const db = makeDb([[]]);
    await expect(getSlot('no-slot', db)).rejects.toMatchObject({ code: 'SLOT_NOT_FOUND' });
  });
});

// ===========================================================================
// 12. listSlots
// ===========================================================================

describe('listSlots', () => {
  it('returns slots for given date', async () => {
    const s2 = { ...slotRow, id: 's2', entry_time: '14:00', exit_time: '16:00' };
    const db = makeDb([[slotRow, s2]]);
    const slots = await listSlots(VENUE_ID, '2026-05-01', db);
    expect(slots).toHaveLength(2);
    const sql = db.query.mock.calls[0][0] as string;
    expect(sql).toContain('slot_date');
    expect(sql).toContain('ORDER BY entry_time');
  });
});

// ===========================================================================
// 13. getAvailableSlots
// ===========================================================================

describe('getAvailableSlots', () => {
  it('returns only available slots in date range', async () => {
    const s2 = { ...slotRow, id: 's2', slot_date: '2026-05-02' };
    const db = makeDb([[slotRow, s2]]);
    const slots = await getAvailableSlots(VENUE_ID, '2026-05-01', '2026-05-07', db);
    expect(slots).toHaveLength(2);
    const sql = db.query.mock.calls[0][0] as string;
    expect(sql).toContain("status = 'available'");
    expect(sql).toContain('BETWEEN');
  });
});

// ===========================================================================
// 14. bulkCreateSlots
// ===========================================================================

describe('bulkCreateSlots', () => {
  it('returns empty array for empty input', async () => {
    const db = makeDb([]);
    const slots = await bulkCreateSlots(VENUE_ID, [], db);
    expect(slots).toEqual([]);
    expect(db.query).not.toHaveBeenCalled();
  });

  it('creates multiple slots in one query', async () => {
    const s2 = { ...slotRow, id: 's2', entry_time: '14:00', exit_time: '16:00' };
    const db = makeDb([[slotRow, s2]]);
    const slots = await bulkCreateSlots(VENUE_ID, [
      { slotDate: '2026-05-01', entryTime: '10:00', exitTime: '12:00', capacity: 100 },
      { slotDate: '2026-05-01', entryTime: '14:00', exitTime: '16:00', capacity: 100 },
    ], db);
    expect(slots).toHaveLength(2);
    expect(db.query).toHaveBeenCalledOnce();
    const sql = db.query.mock.calls[0][0] as string;
    expect(sql).toContain('ON CONFLICT DO NOTHING');
  });
});

// ===========================================================================
// 15. closeSlot
// ===========================================================================

describe('closeSlot', () => {
  it('sets status to closed', async () => {
    const closedSlot = { ...slotRow, status: 'closed' };
    const db = makeDb([[closedSlot]]);
    const slot = await closeSlot(SLOT_ID, db);
    expect(slot.status).toBe('closed');
    const sql = db.query.mock.calls[0][0] as string;
    expect(sql).toContain("status = 'closed'");
  });

  it('throws SLOT_NOT_FOUND for unknown id', async () => {
    const db = makeDb([[]]);
    await expect(closeSlot('no-slot', db)).rejects.toMatchObject({ code: 'SLOT_NOT_FOUND' });
  });
});

// ===========================================================================
// 16. updateSlotCapacity
// ===========================================================================

describe('updateSlotCapacity', () => {
  it('updates capacity and returns slot', async () => {
    const updated = { ...slotRow, capacity: 150 };
    const db = makeDb([[updated]]);
    const slot = await updateSlotCapacity(SLOT_ID, 150, db);
    expect(slot.capacity).toBe(150);
  });

  it('throws SLOT_NOT_FOUND when booked_count exceeds new capacity', async () => {
    const db = makeDb([[]]); // no row — constraint blocks update
    await expect(updateSlotCapacity(SLOT_ID, 5, db)).rejects.toMatchObject({ code: 'SLOT_NOT_FOUND' });
  });
});

// ===========================================================================
// 17. createEntryBooking — valid flow
// ===========================================================================

describe('createEntryBooking — valid', () => {
  function makeBookingDb(slotStatus = 'available', bookedCount = 20, capacity = 100) {
    // query 1: slot lookup; query 2: fetch booking by ref
    return makeDb([
      [{ ...slotRow, status: slotStatus, booked_count: bookedCount, capacity }],
      [bookingRow],
    ]);
  }

  it('creates booking and returns it', async () => {
    const db = makeBookingDb();
    const booking = await createEntryBooking({
      entrySlotId: SLOT_ID,
      userId: USER_ID,
      promoterId: PROMOTER_ID,
      ticketLines: [
        { ticketTypeId: 'tt-1', name: 'Dospělý', quantity: 2, unitPriceHellers: 28000, totalHellers: 56000 },
      ],
    }, db);
    expect(booking.totalVisitors).toBe(2);
    expect(booking.totalHellers).toBe(56000);
    expect(booking.status).toBe('confirmed');
  });

  it('calls execute 3 times — insert, booked_count update, zone_access', async () => {
    const db = makeBookingDb();
    await createEntryBooking({
      entrySlotId: SLOT_ID,
      userId: USER_ID,
      promoterId: PROMOTER_ID,
      ticketLines: [
        { ticketTypeId: 'tt-1', name: 'Dospělý', quantity: 2, unitPriceHellers: 28000, totalHellers: 56000 },
      ],
    }, db);
    // execute called: INSERT booking, UPDATE booked_count, INSERT zone_access
    expect(db.execute).toHaveBeenCalledTimes(3);
  });

  it('calls execute 4 times when slot becomes full after booking', async () => {
    // capacity=22, booked=20, booking for 2 visitors -> exactly full
    const db = makeBookingDb('available', 20, 22);
    await createEntryBooking({
      entrySlotId: SLOT_ID,
      userId: USER_ID,
      promoterId: PROMOTER_ID,
      ticketLines: [
        { ticketTypeId: 'tt-1', name: 'Dospělý', quantity: 2, unitPriceHellers: 28000, totalHellers: 56000 },
      ],
    }, db);
    // INSERT booking + UPDATE booked_count + UPDATE status=full + INSERT zone_access
    expect(db.execute).toHaveBeenCalledTimes(4);
  });

  it('booking_ref matches format MUS-YYYYMMDD-XXXXXX', async () => {
    const db = makeBookingDb();
    const booking = await createEntryBooking({
      entrySlotId: SLOT_ID,
      userId: USER_ID,
      promoterId: PROMOTER_ID,
      ticketLines: [
        { ticketTypeId: 'tt-1', name: 'Dospělý', quantity: 1, unitPriceHellers: 28000, totalHellers: 28000 },
      ],
    }, db);
    expect(booking.bookingRef).toMatch(/^MUS-\d{8}-\d{6}$/);
  });
});

// ===========================================================================
// 18. createEntryBooking — slot full / closed
// ===========================================================================

describe('createEntryBooking — errors', () => {
  it('throws SLOT_NOT_FOUND when slot missing', async () => {
    const db = makeDb([[]]); // no slot
    await expect(createEntryBooking({
      entrySlotId: 'no-slot',
      userId: USER_ID,
      promoterId: PROMOTER_ID,
      ticketLines: [],
    }, db)).rejects.toMatchObject({ code: 'SLOT_NOT_FOUND' });
  });

  it('throws SLOT_FULL when status is full', async () => {
    const db = makeDb([[{ ...slotRow, status: 'full' }]]);
    await expect(createEntryBooking({
      entrySlotId: SLOT_ID,
      userId: USER_ID,
      promoterId: PROMOTER_ID,
      ticketLines: [
        { ticketTypeId: 'tt-1', name: 'Dospělý', quantity: 1, unitPriceHellers: 28000, totalHellers: 28000 },
      ],
    }, db)).rejects.toMatchObject({ code: 'SLOT_FULL' });
  });

  it('throws SLOT_CLOSED when status is closed', async () => {
    const db = makeDb([[{ ...slotRow, status: 'closed' }]]);
    await expect(createEntryBooking({
      entrySlotId: SLOT_ID,
      userId: USER_ID,
      promoterId: PROMOTER_ID,
      ticketLines: [
        { ticketTypeId: 'tt-1', name: 'Dospělý', quantity: 1, unitPriceHellers: 28000, totalHellers: 28000 },
      ],
    }, db)).rejects.toMatchObject({ code: 'SLOT_CLOSED' });
  });

  it('throws SLOT_FULL when visitors exceed remaining capacity', async () => {
    // capacity=22, booked=21, requesting 5 visitors
    const db = makeDb([[{ ...slotRow, capacity: 22, booked_count: 21, status: 'available' }]]);
    await expect(createEntryBooking({
      entrySlotId: SLOT_ID,
      userId: USER_ID,
      promoterId: PROMOTER_ID,
      ticketLines: [
        { ticketTypeId: 'tt-1', name: 'Dospělý', quantity: 5, unitPriceHellers: 28000, totalHellers: 140000 },
      ],
    }, db)).rejects.toMatchObject({ code: 'SLOT_FULL' });
  });
});

// ===========================================================================
// 19. getBooking
// ===========================================================================

describe('getBooking', () => {
  it('returns booking with slot and zones', async () => {
    const rowWithSlot = {
      ...bookingRow,
      slot_data: slotRow,
    };
    // query 1: booking+slot; query 2: zone_access
    const db = makeDb([[rowWithSlot], [
      { entry_booking_id: BOOKING_ID, zone_id: ZONE_ID, is_included: true },
    ]]);
    const booking = await getBooking(BOOKING_ID, db);
    expect(booking.id).toBe(BOOKING_ID);
    expect(booking.slot?.id).toBe(SLOT_ID);
    expect(booking.zones).toHaveLength(1);
    expect(booking.zones?.[0].zoneId).toBe(ZONE_ID);
  });

  it('throws BOOKING_NOT_FOUND for unknown id', async () => {
    const db = makeDb([[]]); // no row
    await expect(getBooking('no-id', db)).rejects.toMatchObject({ code: 'BOOKING_NOT_FOUND' });
  });
});

// ===========================================================================
// 20. getBookingByRef
// ===========================================================================

describe('getBookingByRef', () => {
  it('finds booking by ref', async () => {
    const db = makeDb([[bookingRow]]);
    const booking = await getBookingByRef('MUS-20260501-123456', db);
    expect(booking.bookingRef).toBe('MUS-20260501-123456');
    expect(booking.totalHellers).toBe(56000);
  });

  it('throws BOOKING_NOT_FOUND for unknown ref', async () => {
    const db = makeDb([[]]); // no row
    await expect(getBookingByRef('MUS-BAD-REF', db)).rejects.toMatchObject({ code: 'BOOKING_NOT_FOUND' });
  });
});

// ===========================================================================
// 21. listBookingsForUser
// ===========================================================================

describe('listBookingsForUser', () => {
  it('returns upcoming bookings for user', async () => {
    const db = makeDb([[bookingRow]]);
    const bookings = await listBookingsForUser(USER_ID, db);
    expect(bookings).toHaveLength(1);
    const params = db.query.mock.calls[0][1] as unknown[];
    expect(params[0]).toBe(USER_ID);
  });

  it('returns empty array when no bookings', async () => {
    const db = makeDb([[]]);
    const bookings = await listBookingsForUser(USER_ID, db);
    expect(bookings).toEqual([]);
  });
});

// ===========================================================================
// 22. cancelBooking
// ===========================================================================

describe('cancelBooking', () => {
  it('cancels booking and decrements booked_count', async () => {
    // query: fetch booking; execute: cancel, decrement, reopen
    const db = makeDb([[bookingRow]]);
    const booking = await cancelBooking(BOOKING_ID, db);
    expect(booking.status).toBe('cancelled');
    expect(db.execute).toHaveBeenCalledTimes(3);

    // Second execute decrements booked_count
    const secondCall = db.execute.mock.calls[1];
    expect((secondCall[0] as string)).toContain('booked_count');
    expect(secondCall[1]).toEqual([bookingRow.total_visitors, SLOT_ID]);
  });

  it('throws BOOKING_NOT_FOUND for unknown id', async () => {
    const db = makeDb([[]]); // no row
    await expect(cancelBooking('no-id', db)).rejects.toMatchObject({ code: 'BOOKING_NOT_FOUND' });
  });

  it('throws BOOKING_CANCELLED when already cancelled', async () => {
    const db = makeDb([[{ ...bookingRow, status: 'cancelled' }]]);
    await expect(cancelBooking(BOOKING_ID, db)).rejects.toMatchObject({ code: 'BOOKING_CANCELLED' });
  });
});

// ===========================================================================
// 23. checkInByQR
// ===========================================================================

describe('checkInByQR', () => {
  it('marks booking as used on valid QR', async () => {
    const db = makeDb([[{ ...bookingRow, status: 'confirmed' }]]);
    const booking = await checkInByQR(QR_TOKEN, db);
    expect(booking.status).toBe('used');
    expect(booking.checkedInAt).toBeTruthy();
    expect(db.execute).toHaveBeenCalledOnce();
  });

  it('throws QR_TOKEN_INVALID for unknown token', async () => {
    const db = makeDb([[]]); // no row
    await expect(checkInByQR('bad-token', db)).rejects.toMatchObject({ code: 'QR_TOKEN_INVALID' });
  });

  it('throws BOOKING_ALREADY_USED when status is used', async () => {
    const db = makeDb([[{ ...bookingRow, status: 'used' }]]);
    await expect(checkInByQR(QR_TOKEN, db)).rejects.toMatchObject({ code: 'BOOKING_ALREADY_USED' });
  });

  it('throws BOOKING_CANCELLED when booking is cancelled', async () => {
    const db = makeDb([[{ ...bookingRow, status: 'cancelled' }]]);
    await expect(checkInByQR(QR_TOKEN, db)).rejects.toMatchObject({ code: 'BOOKING_CANCELLED' });
  });

  it('throws QR_TOKEN_INVALID when status is expired', async () => {
    const db = makeDb([[{ ...bookingRow, status: 'expired' }]]);
    await expect(checkInByQR(QR_TOKEN, db)).rejects.toMatchObject({ code: 'QR_TOKEN_INVALID' });
  });
});

// ===========================================================================
// 24. listBookingsForSlot
// ===========================================================================

describe('listBookingsForSlot', () => {
  it('returns stats aggregation for slot', async () => {
    const b2 = { ...bookingRow, id: 'b2', total_visitors: 3, total_hellers: 84000 };
    const db = makeDb([[bookingRow, b2]]);
    const stats = await listBookingsForSlot(SLOT_ID, db);
    expect(stats.slotId).toBe(SLOT_ID);
    expect(stats.totalBookings).toBe(2);
    expect(stats.totalVisitors).toBe(5); // 2 + 3
    expect(stats.bookings).toHaveLength(2);
  });

  it('returns zero counts when no bookings', async () => {
    const db = makeDb([[]]);
    const stats = await listBookingsForSlot(SLOT_ID, db);
    expect(stats.totalBookings).toBe(0);
    expect(stats.totalVisitors).toBe(0);
  });
});

// ===========================================================================
// 25. Full flow: create venue → zone → ticket type → slot → booking → check-in
// ===========================================================================

describe('Full booking flow', () => {
  it('completes museum visit booking from venue creation to check-in', async () => {
    // Step 1: Create venue — 1 query
    const dbVenue = makeDb([[venueRow]]);
    const venue = await createVenue(PROMOTER_ID, { name: 'Národní muzeum', venueType: 'museum' }, dbVenue);
    expect(venue.name).toBe('Národní muzeum');

    // Step 2: Create zone — 1 query
    const dbZone = makeDb([[zoneRow]]);
    const zone = await createZone(venue.id, { name: 'Historická expozice', capacity: 50 }, dbZone);
    expect(zone.venueId).toBe(venue.id);

    // Step 3: Create ticket type — 1 query
    const dbTT = makeDb([[ticketTypeRow]]);
    const tt = await createTicketType(venue.id, { name: 'Dospělý', priceHellers: 28000 }, dbTT);
    expect(tt.priceHellers).toBe(28000);

    // Step 4: Create slot — 1 query
    const dbSlot = makeDb([[slotRow]]);
    const slot = await createEntrySlot(venue.id, {
      slotDate: '2026-05-01', entryTime: '10:00', exitTime: '12:00', capacity: 100,
    }, dbSlot);
    expect(slot.capacity).toBe(100);

    // Step 5: Create booking — 2 queries + 3 executes
    const dbBooking = makeDb([[slotRow], [bookingRow]]);
    const booking = await createEntryBooking({
      entrySlotId: slot.id,
      userId: USER_ID,
      promoterId: PROMOTER_ID,
      ticketLines: [{ ticketTypeId: tt.id, name: tt.name, quantity: 2, unitPriceHellers: tt.priceHellers, totalHellers: 56000 }],
    }, dbBooking);
    expect(booking.totalVisitors).toBe(2);

    // Step 6: Check-in — 1 query + 1 execute
    const dbCheckin = makeDb([[{ ...bookingRow, qr_token: QR_TOKEN }]]);
    const checked = await checkInByQR(QR_TOKEN, dbCheckin);
    expect(checked.status).toBe('used');
  });
});

// ===========================================================================
// 26. API: GET /api/entry/venues
// ===========================================================================

describe('API GET /api/entry/venues', () => {
  it('returns 400 when promoterId missing', async () => {
    const db = makeDb([]);
    const req = makeRequest('GET', 'http://localhost/api/entry/venues');
    const res = await venuesGET(req, { deps: { db } });
    expect(res.status).toBe(400);
    const body = await res.json() as { error: string };
    expect(body.error).toBe('MISSING_PROMOTER_ID');
  });

  it('returns 200 with venues list', async () => {
    const db = makeDb([[venueRow]]);
    const req = makeRequest('GET', `http://localhost/api/entry/venues?promoterId=${PROMOTER_ID}`);
    const res = await venuesGET(req, { deps: { db } });
    expect(res.status).toBe(200);
    const body = await res.json() as { venues: unknown[] };
    expect(body.venues).toHaveLength(1);
  });

  it('filters by venueType param', async () => {
    const db = makeDb([[venueRow]]);
    const req = makeRequest('GET', `http://localhost/api/entry/venues?promoterId=${PROMOTER_ID}&venueType=museum`);
    const res = await venuesGET(req, { deps: { db } });
    expect(res.status).toBe(200);
  });
});

// ===========================================================================
// 27. API: POST /api/entry/venues
// ===========================================================================

describe('API POST /api/entry/venues', () => {
  it('returns 400 when promoterId missing', async () => {
    const db = makeDb([]);
    const req = makeRequest('POST', 'http://localhost/api/entry/venues', { name: 'X', venueType: 'museum' });
    const res = await venuesPOST(req, { deps: { db } });
    expect(res.status).toBe(400);
  });

  it('returns 201 on success', async () => {
    const db = makeDb([[venueRow]]);
    const req = makeRequest('POST', 'http://localhost/api/entry/venues', {
      promoterId: PROMOTER_ID,
      name: 'Národní muzeum',
      venueType: 'museum',
    });
    const res = await venuesPOST(req, { deps: { db } });
    expect(res.status).toBe(201);
    const body = await res.json() as { venue: { name: string } };
    expect(body.venue.name).toBe('Národní muzeum');
  });

  it('returns 409 on duplicate', async () => {
    const db = makeDb([[]]); // empty → VENUE_DUPLICATE
    const req = makeRequest('POST', 'http://localhost/api/entry/venues', {
      promoterId: PROMOTER_ID,
      name: 'Dup',
      venueType: 'museum',
    });
    const res = await venuesPOST(req, { deps: { db } });
    expect(res.status).toBe(409);
  });
});

// ===========================================================================
// 28. API: GET /api/entry/venues/[venueId]
// ===========================================================================

describe('API GET /api/entry/venues/[venueId]', () => {
  it('returns 200 with venue', async () => {
    const db = makeDb([[venueRowWithCounts]]);
    const req = makeRequest('GET', `http://localhost/api/entry/venues/${VENUE_ID}`);
    const res = await venueGET(req, { params: { venueId: VENUE_ID }, deps: { db } });
    expect(res.status).toBe(200);
    const body = await res.json() as { venue: { id: string } };
    expect(body.venue.id).toBe(VENUE_ID);
  });

  it('returns 404 when not found', async () => {
    const db = makeDb([[]]); // no row
    const req = makeRequest('GET', `http://localhost/api/entry/venues/no-id`);
    const res = await venueGET(req, { params: { venueId: 'no-id' }, deps: { db } });
    expect(res.status).toBe(404);
  });
});

// ===========================================================================
// 29. API: GET /api/entry/venues/[venueId]/slots
// ===========================================================================

describe('API GET /api/entry/venues/[venueId]/slots', () => {
  it('returns 200 with available slots', async () => {
    const db = makeDb([[slotRow]]);
    const req = makeRequest('GET', `http://localhost/api/entry/venues/${VENUE_ID}/slots?dateFrom=2026-05-01&dateTo=2026-05-07`);
    const res = await slotsGET(req, { params: { venueId: VENUE_ID }, deps: { db } });
    expect(res.status).toBe(200);
    const body = await res.json() as { slots: unknown[] };
    expect(body.slots).toHaveLength(1);
  });
});

// ===========================================================================
// 30. API: POST /api/entry/venues/[venueId]/slots — bulk
// ===========================================================================

describe('API POST /api/entry/venues/[venueId]/slots', () => {
  it('creates single slot', async () => {
    const db = makeDb([[slotRow]]);
    const req = makeRequest('POST', `http://localhost/api/entry/venues/${VENUE_ID}/slots`, {
      slotDate: '2026-05-01',
      entryTime: '10:00',
      exitTime: '12:00',
      capacity: 100,
    });
    const res = await slotsPOST(req, { params: { venueId: VENUE_ID }, deps: { db } });
    expect(res.status).toBe(201);
    const body = await res.json() as { slot: { id: string } };
    expect(body.slot.id).toBe(SLOT_ID);
  });

  it('creates bulk slots', async () => {
    const s2 = { ...slotRow, id: 's2', entry_time: '14:00' };
    const db = makeDb([[slotRow, s2]]);
    const req = makeRequest('POST', `http://localhost/api/entry/venues/${VENUE_ID}/slots`, {
      bulk: true,
      slots: [
        { slotDate: '2026-05-01', entryTime: '10:00', exitTime: '12:00', capacity: 100 },
        { slotDate: '2026-05-01', entryTime: '14:00', exitTime: '16:00', capacity: 100 },
      ],
    });
    const res = await slotsPOST(req, { params: { venueId: VENUE_ID }, deps: { db } });
    expect(res.status).toBe(201);
    const body = await res.json() as { slots: unknown[]; created: number };
    expect(body.created).toBe(2);
  });
});

// ===========================================================================
// 31. API: POST /api/entry/checkin
// ===========================================================================

describe('API POST /api/entry/checkin', () => {
  it('returns 400 when qrToken missing', async () => {
    const db = makeDb([]);
    const req = makeRequest('POST', 'http://localhost/api/entry/checkin', {});
    const res = await checkinPOST(req, { deps: { db } });
    expect(res.status).toBe(400);
    const body = await res.json() as { error: string };
    expect(body.error).toBe('MISSING_QR_TOKEN');
  });

  it('returns 200 with status granted on valid QR', async () => {
    const db = makeDb([[{ ...bookingRow, status: 'confirmed' }]]);
    const req = makeRequest('POST', 'http://localhost/api/entry/checkin', { qrToken: QR_TOKEN });
    const res = await checkinPOST(req, { deps: { db } });
    expect(res.status).toBe(200);
    const body = await res.json() as { status: string };
    expect(body.status).toBe('granted');
  });

  it('returns 409 with status denied when already used', async () => {
    const db = makeDb([[{ ...bookingRow, status: 'used' }]]);
    const req = makeRequest('POST', 'http://localhost/api/entry/checkin', { qrToken: QR_TOKEN });
    const res = await checkinPOST(req, { deps: { db } });
    expect(res.status).toBe(409);
    const body = await res.json() as { status: string };
    expect(body.status).toBe('denied');
  });

  it('returns 404 with status denied for invalid QR', async () => {
    const db = makeDb([[]]); // no booking
    const req = makeRequest('POST', 'http://localhost/api/entry/checkin', { qrToken: 'bad-qr' });
    const res = await checkinPOST(req, { deps: { db } });
    expect(res.status).toBe(404);
    const body = await res.json() as { status: string };
    expect(body.status).toBe('denied');
  });
});

// ===========================================================================
// 32. API: GET & PATCH /api/entry/bookings/[bookingId]
// ===========================================================================

describe('API /api/entry/bookings/[bookingId]', () => {
  it('GET returns 200 with booking and slot', async () => {
    const rowWithSlot = { ...bookingRow, slot_data: slotRow };
    const db = makeDb([[rowWithSlot], [{ entry_booking_id: BOOKING_ID, zone_id: ZONE_ID, is_included: true }]]);
    const req = makeRequest('GET', `http://localhost/api/entry/bookings/${BOOKING_ID}`);
    const res = await bookingGET(req, { params: { bookingId: BOOKING_ID }, deps: { db } });
    expect(res.status).toBe(200);
    const body = await res.json() as { booking: { id: string } };
    expect(body.booking.id).toBe(BOOKING_ID);
  });

  it('GET returns 404 for unknown booking', async () => {
    const db = makeDb([[]]); // no row
    const req = makeRequest('GET', `http://localhost/api/entry/bookings/no-id`);
    const res = await bookingGET(req, { params: { bookingId: 'no-id' }, deps: { db } });
    expect(res.status).toBe(404);
  });

  it('PATCH cancel returns 200', async () => {
    const db = makeDb([[bookingRow]]);
    const req = makeRequest('PATCH', `http://localhost/api/entry/bookings/${BOOKING_ID}`, { action: 'cancel' });
    const res = await bookingPATCH(req, { params: { bookingId: BOOKING_ID }, deps: { db } });
    expect(res.status).toBe(200);
    const body = await res.json() as { booking: { status: string } };
    expect(body.booking.status).toBe('cancelled');
  });

  it('PATCH returns 400 for invalid action', async () => {
    const db = makeDb([]);
    const req = makeRequest('PATCH', `http://localhost/api/entry/bookings/${BOOKING_ID}`, { action: 'refund' });
    const res = await bookingPATCH(req, { params: { bookingId: BOOKING_ID }, deps: { db } });
    expect(res.status).toBe(400);
  });
});

// ===========================================================================
// 33. API: GET /api/entry/bookings/ref/[bookingRef]
// ===========================================================================

describe('API GET /api/entry/bookings/ref/[bookingRef]', () => {
  it('returns 200 with booking', async () => {
    const db = makeDb([[bookingRow]]);
    const req = makeRequest('GET', `http://localhost/api/entry/bookings/ref/MUS-20260501-123456`);
    const res = await bookingRefGET(req, { params: { bookingRef: 'MUS-20260501-123456' }, deps: { db } });
    expect(res.status).toBe(200);
    const body = await res.json() as { booking: { bookingRef: string } };
    expect(body.booking.bookingRef).toBe('MUS-20260501-123456');
  });

  it('returns 404 for unknown ref', async () => {
    const db = makeDb([[]]); // no row
    const req = makeRequest('GET', `http://localhost/api/entry/bookings/ref/BAD-REF`);
    const res = await bookingRefGET(req, { params: { bookingRef: 'BAD-REF' }, deps: { db } });
    expect(res.status).toBe(404);
  });
});

// ===========================================================================
// 34. API: GET & POST /api/entry/venues/[venueId]/zones
// ===========================================================================

describe('API /api/entry/venues/[venueId]/zones', () => {
  it('GET returns 200 with zones list', async () => {
    const db = makeDb([[zoneRow]]);
    const req = makeRequest('GET', `http://localhost/api/entry/venues/${VENUE_ID}/zones`);
    const res = await zonesGET(req, { params: { venueId: VENUE_ID }, deps: { db } });
    expect(res.status).toBe(200);
    const body = await res.json() as { zones: unknown[] };
    expect(body.zones).toHaveLength(1);
  });

  it('POST creates zone and returns 201', async () => {
    const db = makeDb([[zoneRow]]);
    const req = makeRequest('POST', `http://localhost/api/entry/venues/${VENUE_ID}/zones`, {
      name: 'Historická expozice',
      capacity: 50,
    });
    const res = await zonesPOST(req, { params: { venueId: VENUE_ID }, deps: { db } });
    expect(res.status).toBe(201);
    const body = await res.json() as { zone: { id: string } };
    expect(body.zone.id).toBe(ZONE_ID);
  });

  it('POST returns 409 on duplicate zone', async () => {
    const db = makeDb([[]]); // empty → ZONE_DUPLICATE
    const req = makeRequest('POST', `http://localhost/api/entry/venues/${VENUE_ID}/zones`, {
      name: 'Dup Zone',
      capacity: 10,
    });
    const res = await zonesPOST(req, { params: { venueId: VENUE_ID }, deps: { db } });
    expect(res.status).toBe(409);
  });
});

// ===========================================================================
// 35. API: GET & POST /api/entry/venues/[venueId]/ticket-types
// ===========================================================================

describe('API /api/entry/venues/[venueId]/ticket-types', () => {
  it('GET returns 200 with ticket types', async () => {
    const db = makeDb([[ticketTypeRow]]);
    const req = makeRequest('GET', `http://localhost/api/entry/venues/${VENUE_ID}/ticket-types`);
    const res = await ticketTypesGET(req, { params: { venueId: VENUE_ID }, deps: { db } });
    expect(res.status).toBe(200);
    const body = await res.json() as { ticketTypes: unknown[] };
    expect(body.ticketTypes).toHaveLength(1);
  });

  it('POST creates ticket type and returns 201', async () => {
    const db = makeDb([[ticketTypeRow]]);
    const req = makeRequest('POST', `http://localhost/api/entry/venues/${VENUE_ID}/ticket-types`, {
      name: 'Dospělý',
      priceHellers: 28000,
    });
    const res = await ticketTypesPOST(req, { params: { venueId: VENUE_ID }, deps: { db } });
    expect(res.status).toBe(201);
    const body = await res.json() as { ticketType: { priceHellers: number } };
    expect(body.ticketType.priceHellers).toBe(28000);
  });
});

// ===========================================================================
// 36. API: POST /api/entry/venues/[venueId]/bookings
// ===========================================================================

describe('API POST /api/entry/venues/[venueId]/bookings', () => {
  it('returns 201 with booking on success', async () => {
    const db = makeDb([[slotRow], [bookingRow]]);
    const req = makeRequest('POST', `http://localhost/api/entry/venues/${VENUE_ID}/bookings`, {
      entrySlotId: SLOT_ID,
      userId: USER_ID,
      promoterId: PROMOTER_ID,
      ticketLines: [
        { ticketTypeId: 'tt-1', name: 'Dospělý', quantity: 2, unitPriceHellers: 28000, totalHellers: 56000 },
      ],
    });
    const res = await bookingsPOST(req, { params: { venueId: VENUE_ID }, deps: { db } });
    expect(res.status).toBe(201);
    const body = await res.json() as { booking: { status: string } };
    expect(body.booking.status).toBe('confirmed');
  });

  it('returns 409 when slot is full', async () => {
    const db = makeDb([[{ ...slotRow, status: 'full' }]]);
    const req = makeRequest('POST', `http://localhost/api/entry/venues/${VENUE_ID}/bookings`, {
      entrySlotId: SLOT_ID,
      userId: USER_ID,
      promoterId: PROMOTER_ID,
      ticketLines: [
        { ticketTypeId: 'tt-1', name: 'Dospělý', quantity: 1, unitPriceHellers: 28000, totalHellers: 28000 },
      ],
    });
    const res = await bookingsPOST(req, { params: { venueId: VENUE_ID }, deps: { db } });
    expect(res.status).toBe(409);
    const body = await res.json() as { error: string };
    expect(body.error).toBe('SLOT_FULL');
  });
});

// ===========================================================================
// 37. API: PATCH /api/entry/venues/[venueId] — update venue
// ===========================================================================

describe('API PATCH /api/entry/venues/[venueId]', () => {
  it('returns 200 with updated venue', async () => {
    const updated = { ...venueRow, city: 'Brno' };
    const db = makeDb([[updated]]);
    const req = makeRequest('PATCH', `http://localhost/api/entry/venues/${VENUE_ID}`, { city: 'Brno' });
    const res = await venuePATCH(req, { params: { venueId: VENUE_ID }, deps: { db } });
    expect(res.status).toBe(200);
    const body = await res.json() as { venue: { city: string } };
    expect(body.venue.city).toBe('Brno');
  });

  it('returns 404 when venue not found', async () => {
    const db = makeDb([[]]); // no row
    const req = makeRequest('PATCH', `http://localhost/api/entry/venues/no-id`, { name: 'X' });
    const res = await venuePATCH(req, { params: { venueId: 'no-id' }, deps: { db } });
    expect(res.status).toBe(404);
  });
});
