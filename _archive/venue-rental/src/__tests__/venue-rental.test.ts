import { describe, it, expect, vi, beforeEach } from 'vitest';
import { calculateRentalPrice } from '../lib/pricing';
import {
  createSpace,
  checkAvailability,
  createBooking,
  confirmBooking,
  cancelBooking,
  completeBooking,
  markNoShow,
  getSpaceSchedule,
  getRevenueSummary,
} from '../services/venue-rental.service';
import type { CreateSpaceParams } from '../services/venue-rental.service';
import {
  VenueRentalError,
  type RentalSpace,
  type SpaceBooking,
  type DbAdapter,
  type ServiceDeps,
} from '../types/venue-rental.types';

// ── Helpers ──────────────────────────────────────────────────────────────────

function makeSpace(overrides: Partial<RentalSpace> = {}): RentalSpace {
  return {
    id: 'space-1',
    venueId: 'venue-1',
    organizerId: 'org-1',
    name: 'Velký sál',
    description: 'Reprezentativní sál pro akce',
    capacityStanding: 200,
    capacitySeated: 120,
    amenities: ['projector', 'pa_system'],
    status: 'available',
    pricingRules: [
      { unit: 'hour', priceCzk: 1000 },
      { unit: 'half_day', priceCzk: 3500 },
      { unit: 'full_day', priceCzk: 6000 },
    ],
    minBookingHours: 2,
    bufferMinutes: 60,
    createdAt: new Date('2026-01-01T00:00:00Z'),
    ...overrides,
  };
}

function makeBooking(overrides: Partial<SpaceBooking> = {}): SpaceBooking {
  return {
    id: 'booking-1',
    spaceId: 'space-1',
    organizerId: 'org-1',
    clientName: 'Jan Novák',
    clientEmail: 'jan@example.com',
    clientPhone: '+420777123456',
    companyName: 'Firma s.r.o.',
    ico: '12345678',
    category: 'conference',
    startAt: new Date('2026-06-01T10:00:00Z'),
    endAt: new Date('2026-06-01T14:00:00Z'),
    totalHours: 4,
    status: 'pending',
    quotedPriceCzk: 3500,
    depositPaidCzk: 1000,
    finalPriceCzk: null,
    notes: null,
    createdAt: new Date('2026-05-01T00:00:00Z'),
    ...overrides,
  };
}

function makeDb(overrides: Partial<DbAdapter> = {}): DbAdapter {
  return {
    query: vi.fn(async () => []),
    execute: vi.fn(async () => undefined),
    transaction: vi.fn(async (fn) => fn(makeDb())),
    ...overrides,
  };
}

function makeDeps(dbOverrides: Partial<DbAdapter> = {}, now?: () => Date): ServiceDeps {
  return {
    db: makeDb(dbOverrides),
    now: now ?? (() => new Date('2026-04-15T12:00:00Z')),
  };
}

// ── calculateRentalPrice ─────────────────────────────────────────────────────

describe('calculateRentalPrice', () => {
  const rules = [
    { unit: 'hour' as const, priceCzk: 1000 },
    { unit: 'half_day' as const, priceCzk: 3500 },
    { unit: 'full_day' as const, priceCzk: 6000 },
  ];

  it('uses hourly rate for short bookings (< 4 hours)', () => {
    expect(calculateRentalPrice(2, rules)).toBe(2000);
  });

  it('uses hourly rate for exactly 3 hours', () => {
    expect(calculateRentalPrice(3, rules)).toBe(3000);
  });

  it('uses half_day rule at exactly 4 hours', () => {
    expect(calculateRentalPrice(4, rules)).toBe(3500);
  });

  it('uses half_day rule for 5 and 7 hours', () => {
    expect(calculateRentalPrice(5, rules)).toBe(3500);
    expect(calculateRentalPrice(7, rules)).toBe(3500);
  });

  it('uses full_day rule at exactly 8 hours', () => {
    expect(calculateRentalPrice(8, rules)).toBe(6000);
  });

  it('uses full_day rule for 10 and 12 hours', () => {
    expect(calculateRentalPrice(10, rules)).toBe(6000);
    expect(calculateRentalPrice(12, rules)).toBe(6000);
  });

  it('falls back to hourly when only hour rule present', () => {
    const hourOnly = [{ unit: 'hour' as const, priceCzk: 500 }];
    expect(calculateRentalPrice(8, hourOnly)).toBe(4000);
  });

  it('returns 0 when no rules provided', () => {
    expect(calculateRentalPrice(4, [])).toBe(0);
  });
});

// ── createSpace ──────────────────────────────────────────────────────────────

describe('createSpace', () => {
  it('inserts space and returns it with status available', async () => {
    const db = makeDb();
    const deps = { db, now: () => new Date('2026-04-15T12:00:00Z') };

    const params: CreateSpaceParams = {
      venueId: 'venue-1',
      organizerId: 'org-1',
      name: 'Konferenční místnost',
      description: 'Moderní konferenční prostor',
      capacityStanding: 50,
      capacitySeated: 30,
      amenities: ['projector'],
      pricingRules: [{ unit: 'hour', priceCzk: 800 }],
      minBookingHours: 2,
      bufferMinutes: 60,
    };

    const result = await createSpace(params, deps);

    expect(db.execute).toHaveBeenCalledOnce();
    expect(result.status).toBe('available');
    expect(result.name).toBe('Konferenční místnost');
    expect(result.organizerId).toBe('org-1');
    expect(result.id).toBeTruthy();
    expect(result.createdAt).toEqual(new Date('2026-04-15T12:00:00Z'));
  });
});

// ── checkAvailability ────────────────────────────────────────────────────────

describe('checkAvailability', () => {
  it('returns available=true when no conflicts', async () => {
    const space = makeSpace();
    const db = makeDb({
      query: vi.fn()
        .mockResolvedValueOnce([space])   // space lookup
        .mockResolvedValueOnce([]),        // no conflicts
    });
    const deps = makeDeps({}, undefined);
    deps.db = db;

    const result = await checkAvailability(
      'space-1',
      new Date('2026-06-01T10:00:00Z'),
      new Date('2026-06-01T14:00:00Z'),
      deps
    );

    expect(result.available).toBe(true);
    expect(result.conflicts).toHaveLength(0);
  });

  it('returns available=false when conflict exists (without buffer accounting)', async () => {
    const space = makeSpace({ bufferMinutes: 0 });
    const conflict = makeBooking();
    const db = makeDb({
      query: vi.fn()
        .mockResolvedValueOnce([space])
        .mockResolvedValueOnce([conflict]),
    });
    const deps = makeDeps({}, undefined);
    deps.db = db;

    const result = await checkAvailability(
      'space-1',
      new Date('2026-06-01T12:00:00Z'),
      new Date('2026-06-01T16:00:00Z'),
      deps
    );

    expect(result.available).toBe(false);
    expect(result.conflicts).toHaveLength(1);
  });

  it('returns available=false when buffer creates a conflict', async () => {
    const space = makeSpace({ bufferMinutes: 60 });
    // Booking immediately after requested slot would conflict due to 60 min buffer
    const conflict = makeBooking({
      startAt: new Date('2026-06-01T14:30:00Z'),
      endAt: new Date('2026-06-01T18:00:00Z'),
    });
    const db = makeDb({
      query: vi.fn()
        .mockResolvedValueOnce([space])
        .mockResolvedValueOnce([conflict]),
    });
    const deps = makeDeps({}, undefined);
    deps.db = db;

    const result = await checkAvailability(
      'space-1',
      new Date('2026-06-01T10:00:00Z'),
      new Date('2026-06-01T14:00:00Z'),
      deps
    );

    expect(result.available).toBe(false);
  });

  it('throws SPACE_NOT_FOUND when space does not exist', async () => {
    const db = makeDb({ query: vi.fn().mockResolvedValueOnce([]) });
    const deps = makeDeps({}, undefined);
    deps.db = db;

    await expect(
      checkAvailability(
        'missing-space',
        new Date('2026-06-01T10:00:00Z'),
        new Date('2026-06-01T14:00:00Z'),
        deps
      )
    ).rejects.toThrow(VenueRentalError);
  });
});

// ── createBooking ────────────────────────────────────────────────────────────

describe('createBooking', () => {
  const validInput = {
    spaceId: 'space-1',
    organizerId: 'org-1',
    clientName: 'Jan Novák',
    clientEmail: 'jan@example.com',
    clientPhone: '+420777123456',
    category: 'conference' as const,
    startAt: new Date('2026-06-01T10:00:00Z'),
    endAt: new Date('2026-06-01T14:00:00Z'),
  };

  it('creates booking successfully with correct price', async () => {
    const space = makeSpace();
    const db = makeDb({
      query: vi.fn()
        .mockResolvedValueOnce([space])   // space lookup
        .mockResolvedValueOnce([]),        // no conflicts
    });
    const deps = makeDeps({}, undefined);
    deps.db = db;

    const result = await createBooking(validInput, deps);

    expect(result.status).toBe('pending');
    expect(result.totalHours).toBe(4);
    expect(result.quotedPriceCzk).toBe(3500); // half_day rule
    expect(result.clientName).toBe('Jan Novák');
    expect(result.spaceId).toBe('space-1');
    expect(db.execute).toHaveBeenCalledOnce();
  });

  it('throws INVALID_TIME_RANGE when endAt <= startAt', async () => {
    const deps = makeDeps();

    await expect(
      createBooking(
        {
          ...validInput,
          startAt: new Date('2026-06-01T14:00:00Z'),
          endAt: new Date('2026-06-01T10:00:00Z'),
        },
        deps
      )
    ).rejects.toThrow(VenueRentalError);

    try {
      await createBooking(
        {
          ...validInput,
          startAt: new Date('2026-06-01T14:00:00Z'),
          endAt: new Date('2026-06-01T10:00:00Z'),
        },
        deps
      );
    } catch (e) {
      expect((e as VenueRentalError).code).toBe('INVALID_TIME_RANGE');
    }
  });

  it('throws MIN_BOOKING_HOURS when booking is too short', async () => {
    const space = makeSpace({ minBookingHours: 2 });
    const db = makeDb({
      query: vi.fn().mockResolvedValueOnce([space]),
    });
    const deps = makeDeps({}, undefined);
    deps.db = db;

    await expect(
      createBooking(
        {
          ...validInput,
          startAt: new Date('2026-06-01T10:00:00Z'),
          endAt: new Date('2026-06-01T10:30:00Z'), // only 30 min
        },
        deps
      )
    ).rejects.toMatchObject({ code: 'MIN_BOOKING_HOURS' });
  });

  it('throws TIME_CONFLICT when booking overlaps existing booking', async () => {
    const space = makeSpace();
    const conflict = makeBooking({ status: 'confirmed' });
    const db = makeDb({
      query: vi.fn()
        .mockResolvedValueOnce([space])
        .mockResolvedValueOnce([conflict]),
    });
    const deps = makeDeps({}, undefined);
    deps.db = db;

    await expect(
      createBooking(validInput, deps)
    ).rejects.toMatchObject({ code: 'TIME_CONFLICT' });
  });

  it('throws SPACE_NOT_FOUND when space does not exist', async () => {
    const db = makeDb({
      query: vi.fn().mockResolvedValueOnce([]),
    });
    const deps = makeDeps({}, undefined);
    deps.db = db;

    await expect(
      createBooking(validInput, deps)
    ).rejects.toMatchObject({ code: 'SPACE_NOT_FOUND' });
  });

  it('throws SPACE_IN_MAINTENANCE when space is under maintenance', async () => {
    const space = makeSpace({ status: 'maintenance' });
    const db = makeDb({
      query: vi.fn().mockResolvedValueOnce([space]),
    });
    const deps = makeDeps({}, undefined);
    deps.db = db;

    await expect(
      createBooking(validInput, deps)
    ).rejects.toMatchObject({ code: 'SPACE_IN_MAINTENANCE' });
  });

  it('sets depositPaidCzk=0 when not provided', async () => {
    const space = makeSpace();
    const db = makeDb({
      query: vi.fn()
        .mockResolvedValueOnce([space])
        .mockResolvedValueOnce([]),
    });
    const deps = makeDeps({}, undefined);
    deps.db = db;

    const result = await createBooking(
      { ...validInput, depositPaidCzk: undefined },
      deps
    );
    expect(result.depositPaidCzk).toBe(0);
  });
});

// ── confirmBooking ────────────────────────────────────────────────────────────

describe('confirmBooking', () => {
  it('transitions booking from pending to confirmed', async () => {
    const booking = makeBooking({ status: 'pending' });
    const db = makeDb({
      query: vi.fn().mockResolvedValueOnce([booking]),
    });
    const deps = makeDeps({}, undefined);
    deps.db = db;

    const result = await confirmBooking('booking-1', deps);

    expect(result.status).toBe('confirmed');
    expect(db.execute).toHaveBeenCalledOnce();
  });

  it('throws BOOKING_NOT_FOUND when booking does not exist', async () => {
    const db = makeDb({ query: vi.fn().mockResolvedValueOnce([]) });
    const deps = makeDeps({}, undefined);
    deps.db = db;

    await expect(confirmBooking('missing', deps)).rejects.toMatchObject({
      code: 'BOOKING_NOT_FOUND',
    });
  });
});

// ── cancelBooking ────────────────────────────────────────────────────────────

describe('cancelBooking', () => {
  it('transitions booking to cancelled', async () => {
    const booking = makeBooking({ status: 'confirmed' });
    const db = makeDb({ query: vi.fn().mockResolvedValueOnce([booking]) });
    const deps = makeDeps({}, undefined);
    deps.db = db;

    const result = await cancelBooking('booking-1', 'Client request', deps);

    expect(result.status).toBe('cancelled');
    expect(db.execute).toHaveBeenCalledOnce();
  });

  it('throws BOOKING_NOT_FOUND when booking does not exist', async () => {
    const db = makeDb({ query: vi.fn().mockResolvedValueOnce([]) });
    const deps = makeDeps({}, undefined);
    deps.db = db;

    await expect(cancelBooking('missing', 'reason', deps)).rejects.toMatchObject({
      code: 'BOOKING_NOT_FOUND',
    });
  });
});

// ── completeBooking ───────────────────────────────────────────────────────────

describe('completeBooking', () => {
  it('transitions booking to completed and sets finalPriceCzk', async () => {
    const booking = makeBooking({ status: 'confirmed' });
    const db = makeDb({ query: vi.fn().mockResolvedValueOnce([booking]) });
    const deps = makeDeps({}, undefined);
    deps.db = db;

    const result = await completeBooking('booking-1', 4200, deps);

    expect(result.status).toBe('completed');
    expect(result.finalPriceCzk).toBe(4200);
    expect(db.execute).toHaveBeenCalledOnce();
  });

  it('throws BOOKING_NOT_FOUND when booking does not exist', async () => {
    const db = makeDb({ query: vi.fn().mockResolvedValueOnce([]) });
    const deps = makeDeps({}, undefined);
    deps.db = db;

    await expect(completeBooking('missing', 1000, deps)).rejects.toMatchObject({
      code: 'BOOKING_NOT_FOUND',
    });
  });
});

// ── markNoShow ────────────────────────────────────────────────────────────────

describe('markNoShow', () => {
  it('transitions booking to no_show', async () => {
    const booking = makeBooking({ status: 'confirmed' });
    const db = makeDb({ query: vi.fn().mockResolvedValueOnce([booking]) });
    const deps = makeDeps({}, undefined);
    deps.db = db;

    const result = await markNoShow('booking-1', deps);

    expect(result.status).toBe('no_show');
    expect(db.execute).toHaveBeenCalledOnce();
  });

  it('throws BOOKING_NOT_FOUND when booking does not exist', async () => {
    const db = makeDb({ query: vi.fn().mockResolvedValueOnce([]) });
    const deps = makeDeps({}, undefined);
    deps.db = db;

    await expect(markNoShow('missing', deps)).rejects.toMatchObject({
      code: 'BOOKING_NOT_FOUND',
    });
  });
});

// ── getSpaceSchedule ──────────────────────────────────────────────────────────

describe('getSpaceSchedule', () => {
  it('returns all bookings within the date range', async () => {
    const b1 = makeBooking({ id: 'b1', startAt: new Date('2026-06-01T10:00:00Z') });
    const b2 = makeBooking({ id: 'b2', startAt: new Date('2026-06-02T10:00:00Z') });
    const db = makeDb({ query: vi.fn().mockResolvedValueOnce([b1, b2]) });
    const deps = makeDeps({}, undefined);
    deps.db = db;

    const result = await getSpaceSchedule(
      'space-1',
      new Date('2026-06-01T00:00:00Z'),
      new Date('2026-06-30T00:00:00Z'),
      deps
    );

    expect(result).toHaveLength(2);
    expect(db.query).toHaveBeenCalledWith(
      expect.stringContaining('space_id'),
      expect.arrayContaining(['space-1'])
    );
  });

  it('returns empty array when no bookings in range', async () => {
    const db = makeDb({ query: vi.fn().mockResolvedValueOnce([]) });
    const deps = makeDeps({}, undefined);
    deps.db = db;

    const result = await getSpaceSchedule(
      'space-1',
      new Date('2026-07-01T00:00:00Z'),
      new Date('2026-07-31T00:00:00Z'),
      deps
    );

    expect(result).toHaveLength(0);
  });
});

// ── getRevenueSummary ─────────────────────────────────────────────────────────

describe('getRevenueSummary', () => {
  it('returns correct aggregates for completed bookings', async () => {
    const b1 = makeBooking({
      id: 'b1',
      status: 'completed',
      finalPriceCzk: 6000,
      category: 'conference',
    });
    const b2 = makeBooking({
      id: 'b2',
      status: 'completed',
      finalPriceCzk: 3500,
      category: 'celebration',
    });
    const b3 = makeBooking({
      id: 'b3',
      status: 'cancelled',
      finalPriceCzk: null,
      quotedPriceCzk: 2000,
      category: 'filming',
    });

    const db = makeDb({ query: vi.fn().mockResolvedValueOnce([b1, b2, b3]) });
    const deps = makeDeps({}, undefined);
    deps.db = db;

    const summary = await getRevenueSummary(
      'org-1',
      new Date('2026-06-01T00:00:00Z'),
      new Date('2026-06-30T00:00:00Z'),
      deps
    );

    expect(summary.organizerId).toBe('org-1');
    expect(summary.totalBookings).toBe(3);
    expect(summary.completedBookings).toBe(2);
    expect(summary.totalRevenueCzk).toBe(9500);
    expect(summary.averageBookingValueCzk).toBe(4750);
    expect(summary.topCategories).toHaveLength(2);
  });

  it('returns zero revenue when no completed bookings', async () => {
    const b1 = makeBooking({ id: 'b1', status: 'cancelled' });
    const db = makeDb({ query: vi.fn().mockResolvedValueOnce([b1]) });
    const deps = makeDeps({}, undefined);
    deps.db = db;

    const summary = await getRevenueSummary(
      'org-1',
      new Date('2026-06-01T00:00:00Z'),
      new Date('2026-06-30T00:00:00Z'),
      deps
    );

    expect(summary.totalRevenueCzk).toBe(0);
    expect(summary.averageBookingValueCzk).toBe(0);
    expect(summary.completedBookings).toBe(0);
    expect(summary.topCategories).toHaveLength(0);
  });

  it('returns empty summary when no bookings at all', async () => {
    const db = makeDb({ query: vi.fn().mockResolvedValueOnce([]) });
    const deps = makeDeps({}, undefined);
    deps.db = db;

    const summary = await getRevenueSummary(
      'org-1',
      new Date('2026-06-01T00:00:00Z'),
      new Date('2026-06-30T00:00:00Z'),
      deps
    );

    expect(summary.totalBookings).toBe(0);
    expect(summary.completedBookings).toBe(0);
    expect(summary.totalRevenueCzk).toBe(0);
    expect(summary.topCategories).toHaveLength(0);
  });

  it('sorts topCategories by revenue descending', async () => {
    const bookings = [
      makeBooking({ id: 'b1', status: 'completed', finalPriceCzk: 1000, category: 'filming' }),
      makeBooking({ id: 'b2', status: 'completed', finalPriceCzk: 5000, category: 'conference' }),
      makeBooking({ id: 'b3', status: 'completed', finalPriceCzk: 3000, category: 'celebration' }),
    ];

    const db = makeDb({ query: vi.fn().mockResolvedValueOnce(bookings) });
    const deps = makeDeps({}, undefined);
    deps.db = db;

    const summary = await getRevenueSummary(
      'org-1',
      new Date('2026-06-01T00:00:00Z'),
      new Date('2026-06-30T00:00:00Z'),
      deps
    );

    expect(summary.topCategories[0]?.category).toBe('conference');
    expect(summary.topCategories[1]?.category).toBe('celebration');
    expect(summary.topCategories[2]?.category).toBe('filming');
  });
});
