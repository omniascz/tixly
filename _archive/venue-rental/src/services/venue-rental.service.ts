import type {
  RentalSpace,
  SpaceBooking,
  BookingInput,
  RentalRevenueSummary,
  RentalCategory,
  ServiceDeps,
} from '../types/venue-rental.types';
import { VenueRentalError } from '../types/venue-rental.types';
import { calculateRentalPrice } from '../lib/pricing';

function generateId(): string {
  return Math.random().toString(36).slice(2) + Date.now().toString(36);
}

export type CreateSpaceParams = Omit<RentalSpace, 'id' | 'status' | 'createdAt'>;

export async function createSpace(
  params: CreateSpaceParams,
  deps: ServiceDeps
): Promise<RentalSpace> {
  const now = deps.now ? deps.now() : new Date();
  const id = generateId();

  await deps.db.execute(
    `INSERT INTO rental_spaces (id, venue_id, organizer_id, name, description,
      capacity_standing, capacity_seated, amenities, status, pricing_rules,
      min_booking_hours, buffer_minutes, created_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)`,
    [
      id,
      params.venueId,
      params.organizerId,
      params.name,
      params.description,
      params.capacityStanding,
      params.capacitySeated,
      JSON.stringify(params.amenities),
      'available',
      JSON.stringify(params.pricingRules),
      params.minBookingHours,
      params.bufferMinutes,
      now.toISOString(),
    ]
  );

  return {
    ...params,
    id,
    status: 'available',
    createdAt: now,
  };
}

export interface AvailabilityResult {
  available: boolean;
  conflicts: SpaceBooking[];
}

export async function checkAvailability(
  spaceId: string,
  startAt: Date,
  endAt: Date,
  deps: ServiceDeps
): Promise<AvailabilityResult> {
  const spaces = await deps.db.query<RentalSpace>(
    `SELECT * FROM rental_spaces WHERE id = $1`,
    [spaceId]
  );

  const space = spaces[0];
  if (!space) {
    throw new VenueRentalError('SPACE_NOT_FOUND', `Space not found: ${spaceId}`);
  }

  const bufferMs = (space.bufferMinutes ?? 60) * 60 * 1000;
  const bufferedStart = new Date(startAt.getTime() - bufferMs);
  const bufferedEnd = new Date(endAt.getTime() + bufferMs);

  const conflicts = await deps.db.query<SpaceBooking>(
    `SELECT * FROM space_bookings
     WHERE space_id = $1
       AND status IN ('confirmed', 'pending')
       AND start_at < $2
       AND end_at > $3`,
    [spaceId, bufferedEnd.toISOString(), bufferedStart.toISOString()]
  );

  return {
    available: conflicts.length === 0,
    conflicts,
  };
}

export async function createBooking(
  input: BookingInput,
  deps: ServiceDeps
): Promise<SpaceBooking> {
  const now = deps.now ? deps.now() : new Date();

  // Validate time range
  if (input.endAt <= input.startAt) {
    throw new VenueRentalError('INVALID_TIME_RANGE', 'endAt must be after startAt');
  }

  const totalHours = (input.endAt.getTime() - input.startAt.getTime()) / 3_600_000;

  // Load space
  const spaces = await deps.db.query<RentalSpace>(
    `SELECT * FROM rental_spaces WHERE id = $1`,
    [input.spaceId]
  );

  const space = spaces[0];
  if (!space) {
    throw new VenueRentalError('SPACE_NOT_FOUND', `Space not found: ${input.spaceId}`);
  }

  if (space.status === 'maintenance') {
    throw new VenueRentalError('SPACE_IN_MAINTENANCE', `Space ${input.spaceId} is in maintenance`);
  }

  if (space.status !== 'available') {
    throw new VenueRentalError('SPACE_NOT_AVAILABLE', `Space ${input.spaceId} is not available`);
  }

  // Validate minimum booking hours
  if (totalHours < space.minBookingHours) {
    throw new VenueRentalError(
      'MIN_BOOKING_HOURS',
      `Minimum booking duration is ${space.minBookingHours} hours, got ${totalHours}`
    );
  }

  // Check for conflicts (including buffer)
  const bufferMs = space.bufferMinutes * 60 * 1000;
  const bufferedStart = new Date(input.startAt.getTime() - bufferMs);
  const bufferedEnd = new Date(input.endAt.getTime() + bufferMs);

  const conflicts = await deps.db.query<SpaceBooking>(
    `SELECT * FROM space_bookings
     WHERE space_id = $1
       AND status IN ('confirmed', 'pending')
       AND start_at < $2
       AND end_at > $3`,
    [input.spaceId, bufferedEnd.toISOString(), bufferedStart.toISOString()]
  );

  if (conflicts.length > 0) {
    throw new VenueRentalError('TIME_CONFLICT', `Time slot conflicts with existing booking`);
  }

  const quotedPriceCzk = calculateRentalPrice(totalHours, space.pricingRules);
  const id = generateId();

  await deps.db.execute(
    `INSERT INTO space_bookings
       (id, space_id, organizer_id, client_name, client_email, client_phone,
        company_name, ico, category, start_at, end_at, total_hours, status,
        quoted_price_czk, deposit_paid_czk, final_price_czk, notes, created_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18)`,
    [
      id,
      input.spaceId,
      input.organizerId,
      input.clientName,
      input.clientEmail,
      input.clientPhone ?? null,
      input.companyName ?? null,
      input.ico ?? null,
      input.category,
      input.startAt.toISOString(),
      input.endAt.toISOString(),
      totalHours,
      'pending',
      quotedPriceCzk,
      input.depositPaidCzk ?? 0,
      null,
      input.notes ?? null,
      now.toISOString(),
    ]
  );

  return {
    id,
    spaceId: input.spaceId,
    organizerId: input.organizerId,
    clientName: input.clientName,
    clientEmail: input.clientEmail,
    clientPhone: input.clientPhone ?? null,
    companyName: input.companyName ?? null,
    ico: input.ico ?? null,
    category: input.category,
    startAt: input.startAt,
    endAt: input.endAt,
    totalHours,
    status: 'pending',
    quotedPriceCzk,
    depositPaidCzk: input.depositPaidCzk ?? 0,
    finalPriceCzk: null,
    notes: input.notes ?? null,
    createdAt: now,
  };
}

async function loadBooking(bookingId: string, deps: ServiceDeps): Promise<SpaceBooking> {
  const rows = await deps.db.query<SpaceBooking>(
    `SELECT * FROM space_bookings WHERE id = $1`,
    [bookingId]
  );
  const booking = rows[0];
  if (!booking) {
    throw new VenueRentalError('BOOKING_NOT_FOUND', `Booking not found: ${bookingId}`);
  }
  return booking;
}

export async function confirmBooking(
  bookingId: string,
  deps: ServiceDeps
): Promise<SpaceBooking> {
  const booking = await loadBooking(bookingId, deps);

  await deps.db.execute(
    `UPDATE space_bookings SET status = 'confirmed' WHERE id = $1`,
    [bookingId]
  );

  return { ...booking, status: 'confirmed' };
}

export async function cancelBooking(
  bookingId: string,
  _reason: string,
  deps: ServiceDeps
): Promise<SpaceBooking> {
  const booking = await loadBooking(bookingId, deps);

  await deps.db.execute(
    `UPDATE space_bookings SET status = 'cancelled' WHERE id = $1`,
    [bookingId]
  );

  return { ...booking, status: 'cancelled' };
}

export async function completeBooking(
  bookingId: string,
  finalPriceCzk: number,
  deps: ServiceDeps
): Promise<SpaceBooking> {
  const booking = await loadBooking(bookingId, deps);

  await deps.db.execute(
    `UPDATE space_bookings SET status = 'completed', final_price_czk = $2 WHERE id = $1`,
    [bookingId, finalPriceCzk]
  );

  return { ...booking, status: 'completed', finalPriceCzk };
}

export async function markNoShow(
  bookingId: string,
  deps: ServiceDeps
): Promise<SpaceBooking> {
  const booking = await loadBooking(bookingId, deps);

  await deps.db.execute(
    `UPDATE space_bookings SET status = 'no_show' WHERE id = $1`,
    [bookingId]
  );

  return { ...booking, status: 'no_show' };
}

export async function getSpaceSchedule(
  spaceId: string,
  from: Date,
  to: Date,
  deps: ServiceDeps
): Promise<SpaceBooking[]> {
  return deps.db.query<SpaceBooking>(
    `SELECT * FROM space_bookings
     WHERE space_id = $1
       AND start_at < $3
       AND end_at > $2
     ORDER BY start_at ASC`,
    [spaceId, from.toISOString(), to.toISOString()]
  );
}

export async function getRevenueSummary(
  organizerId: string,
  from: Date,
  to: Date,
  deps: ServiceDeps
): Promise<RentalRevenueSummary> {
  const bookings = await deps.db.query<SpaceBooking>(
    `SELECT * FROM space_bookings
     WHERE organizer_id = $1
       AND created_at >= $2
       AND created_at <= $3`,
    [organizerId, from.toISOString(), to.toISOString()]
  );

  const completedBookings = bookings.filter((b) => b.status === 'completed');
  const totalRevenueCzk = completedBookings.reduce(
    (sum, b) => sum + (b.finalPriceCzk ?? b.quotedPriceCzk),
    0
  );
  const averageBookingValueCzk =
    completedBookings.length > 0 ? totalRevenueCzk / completedBookings.length : 0;

  // Aggregate by category
  const categoryMap = new Map<RentalCategory, { count: number; revenueCzk: number }>();
  for (const b of completedBookings) {
    const existing = categoryMap.get(b.category) ?? { count: 0, revenueCzk: 0 };
    categoryMap.set(b.category, {
      count: existing.count + 1,
      revenueCzk: existing.revenueCzk + (b.finalPriceCzk ?? b.quotedPriceCzk),
    });
  }

  const topCategories = Array.from(categoryMap.entries())
    .map(([category, data]) => ({ category, ...data }))
    .sort((a, b) => b.revenueCzk - a.revenueCzk);

  return {
    organizerId,
    period: { from, to },
    totalBookings: bookings.length,
    completedBookings: completedBookings.length,
    totalRevenueCzk,
    averageBookingValueCzk,
    topCategories,
  };
}
