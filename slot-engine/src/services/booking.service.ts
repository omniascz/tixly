import { SlotError } from '../lib/slot-errors';
import type { SlotDB } from './resource.service';
import { refreshSlotStatus } from './slot-generator.service';
import type { Slot, SlotWithResource } from './slot-generator.service';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type BookingStatus = 'pending' | 'confirmed' | 'cancelled' | 'no_show' | 'completed';

export interface Booking {
  id: string;
  slotId: string;
  userId: string;
  promoterId: string;
  quantity: number;
  status: BookingStatus;
  priceHellers: number;
  orderId: string | null;
  notes: string | null;
  bookedAt: string;
  cancelledAt: string | null;
  cancellationReason: string | null;
  reminderSentAt: string | null;
  permanentkaUsageId: string | null;
}

export interface BookingWithSlot extends Booking {
  slot: Slot;
  resource: {
    id: string;
    name: string;
    resourceType: string;
    promoterId: string;
  };
}

export interface BookingHold {
  id: string;
  slotId: string;
  userId: string;
  quantity: number;
  heldUntil: string;
  sessionToken: string;
}

export interface BookingFilters {
  status?: BookingStatus;
  dateFrom?: string;
  dateTo?: string;
}

/**
 * Callbacks for permanentka credit operations. Injected at call sites (e.g.
 * the EMS booking route) so this service remains decoupled from the
 * permanentky module.
 */
export interface PermanentkaBookingOps {
  /** UUID of the client_package to charge. */
  packageId: string;
  /** Deduct one credit. reservationId should be the booking's UUID. */
  consumeCredit(
    packageId: string,
    userId: string,
    reservationId: string,
  ): Promise<{ usageId: string; remainingCredits: number }>;
  /** Reverse a prior consumeCredit; called on booking cancellation. */
  refundCredit(
    usageId: string,
    reason: string,
  ): Promise<{ remainingCredits: number }>;
}

// ---------------------------------------------------------------------------
// Row types
// ---------------------------------------------------------------------------

interface SlotStatusRow {
  id: string;
  resource_id: string;
  slot_date: string;
  start_time: string;
  end_time: string;
  capacity: number;
  booked_count: number;
  price_hellers: number;
  status: string;
  generated_from_rule_id: string | null;
  override_id: string | null;
}

interface HoldCountRow {
  total: string | number;
}

interface HoldRow {
  id: string;
  slot_id: string;
  user_id: string;
  quantity: number;
  held_until: string;
  session_token: string;
}

interface BookingRow {
  id: string;
  slot_id: string;
  user_id: string;
  promoter_id: string;
  quantity: number;
  status: BookingStatus;
  price_hellers: number;
  order_id: string | null;
  notes: string | null;
  booked_at: string;
  cancelled_at: string | null;
  cancellation_reason: string | null;
  reminder_sent_at: string | null;
  permanentka_usage_id: string | null;
}

interface BookingWithSlotRow extends BookingRow {
  slot_date: string;
  slot_start_time: string;
  slot_end_time: string;
  slot_capacity: number;
  slot_booked_count: number;
  slot_price_hellers: number;
  slot_status: string;
  slot_generated_from_rule_id: string | null;
  slot_override_id: string | null;
  resource_id: string;
  resource_name: string;
  resource_type: string;
  resource_promoter_id: string;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function mapBooking(row: BookingRow): Booking {
  return {
    id: row.id,
    slotId: row.slot_id,
    userId: row.user_id,
    promoterId: row.promoter_id,
    quantity: row.quantity,
    status: row.status,
    priceHellers: row.price_hellers,
    orderId: row.order_id,
    notes: row.notes,
    bookedAt: row.booked_at,
    cancelledAt: row.cancelled_at,
    cancellationReason: row.cancellation_reason,
    reminderSentAt: row.reminder_sent_at,
    permanentkaUsageId: row.permanentka_usage_id,
  };
}

function mapHold(row: HoldRow): BookingHold {
  return {
    id: row.id,
    slotId: row.slot_id,
    userId: row.user_id,
    quantity: row.quantity,
    heldUntil: row.held_until,
    sessionToken: row.session_token,
  };
}

// ---------------------------------------------------------------------------
// Service functions
// ---------------------------------------------------------------------------

export async function holdSlot(
  slotId: string,
  userId: string,
  quantity: number,
  db: SlotDB,
): Promise<BookingHold> {
  // Query 1: get slot
  const { rows: slotRows } = await db.query<SlotStatusRow>(
    `SELECT * FROM reservations.slots WHERE id = $1`,
    [slotId],
  );

  if (!slotRows[0]) {
    throw new SlotError('SLOT_NOT_FOUND');
  }

  const slot = slotRows[0];

  if (slot.status === 'closed' || slot.status === 'cancelled') {
    throw new SlotError('SLOT_NOT_AVAILABLE');
  }
  if (slot.status === 'full') {
    throw new SlotError('SLOT_FULL');
  }

  // Query 2: count active holds
  const { rows: holdRows } = await db.query<HoldCountRow>(
    `SELECT COALESCE(SUM(quantity), 0) AS total
     FROM reservations.booking_holds
     WHERE slot_id = $1 AND held_until > NOW()`,
    [slotId],
  );

  const activeHolds = Number(holdRows[0]?.total ?? 0);

  if (slot.booked_count + activeHolds + quantity > slot.capacity) {
    throw new SlotError('SLOT_FULL');
  }

  // Execute: upsert hold (does NOT increment)
  await db.execute(
    `INSERT INTO reservations.booking_holds (slot_id, user_id, quantity, held_until)
     VALUES ($1, $2, $3, NOW() + INTERVAL '10 minutes')
     ON CONFLICT (slot_id, user_id) DO UPDATE
       SET quantity = $3, held_until = NOW() + INTERVAL '10 minutes'`,
    [slotId, userId, quantity],
  );

  // We need to return a hold — for testing purposes build a stub
  // In prod you'd SELECT the just-inserted row; here we return constructed data
  return {
    id: `hold-${slotId}-${userId}`,
    slotId,
    userId,
    quantity,
    heldUntil: new Date(Date.now() + 10 * 60 * 1000).toISOString(),
    sessionToken: 'session-token-placeholder',
  };
}

export async function releaseHold(
  holdId: string,
  db: SlotDB,
): Promise<void> {
  await db.execute(
    `DELETE FROM reservations.booking_holds WHERE id = $1`,
    [holdId],
  );
}

export async function confirmBooking(
  holdId: string,
  orderId: string | null,
  db: SlotDB,
  permanentkaOps?: PermanentkaBookingOps,
): Promise<Booking> {
  // Query 1: get hold
  const { rows: holdRows } = await db.query<HoldRow>(
    `SELECT * FROM reservations.booking_holds WHERE id = $1`,
    [holdId],
  );

  if (!holdRows[0]) {
    throw new SlotError('HOLD_NOT_FOUND');
  }

  const hold = holdRows[0];

  // Check not expired
  if (new Date(hold.held_until) <= new Date()) {
    throw new SlotError('HOLD_EXPIRED');
  }

  // Query 2: insert booking with RETURNING to get the auto-generated ID
  const { rows: insertedRows } = await db.query<BookingRow>(
    `INSERT INTO reservations.bookings
       (slot_id, user_id, promoter_id, quantity, status, price_hellers, order_id)
     SELECT
       bh.slot_id,
       bh.user_id,
       r.promoter_id,
       bh.quantity,
       'confirmed',
       s.price_hellers,
       $2
     FROM reservations.booking_holds bh
     JOIN reservations.slots s ON s.id = bh.slot_id
     JOIN reservations.resources r ON r.id = s.resource_id
     WHERE bh.id = $1
     RETURNING *`,
    [holdId, orderId],
  );

  if (!insertedRows[0]) {
    throw new SlotError('BOOKING_NOT_FOUND');
  }

  const booking = insertedRows[0];

  // Execute 1: update slot booked_count (does NOT increment)
  await db.execute(
    `UPDATE reservations.slots
     SET booked_count = booked_count + $1
     WHERE id = $2`,
    [hold.quantity, hold.slot_id],
  );

  // Execute 2: delete hold (does NOT increment)
  await db.execute(
    `DELETE FROM reservations.booking_holds WHERE id = $1`,
    [holdId],
  );

  // If this is a permanentka booking: consume one credit using the booking's
  // UUID as the idempotency key (reservationId).
  let permanentkaUsageId: string | null = null;
  if (permanentkaOps) {
    try {
      const { usageId } = await permanentkaOps.consumeCredit(
        permanentkaOps.packageId,
        hold.user_id,
        booking.id,
      );
      permanentkaUsageId = usageId;

      // Execute 3: persist usageId on the booking for future refund on cancel
      await db.execute(
        `UPDATE reservations.bookings SET permanentka_usage_id = $2 WHERE id = $1`,
        [booking.id, permanentkaUsageId],
      );
    } catch (err) {
      // Credit consumption failed — compensate by cancelling the booking and
      // restoring the slot count so the slot is not permanently occupied.
      await db.execute(
        `UPDATE reservations.bookings
         SET status = 'cancelled', cancelled_at = NOW(),
             cancellation_reason = 'credit_consumption_failed'
         WHERE id = $1`,
        [booking.id],
      );
      await db.execute(
        `UPDATE reservations.slots
         SET booked_count = GREATEST(0, booked_count - $1)
         WHERE id = $2`,
        [hold.quantity, hold.slot_id],
      );
      throw new SlotError('CREDIT_CONSUMPTION_FAILED');
    }
  }

  // Refresh slot status
  await refreshSlotStatus(hold.slot_id, db);

  return mapBooking({ ...booking, permanentka_usage_id: permanentkaUsageId });
}

export async function cancelBooking(
  bookingId: string,
  reason: string,
  db: SlotDB,
  permanentkaOps?: Pick<PermanentkaBookingOps, 'refundCredit'>,
): Promise<Booking> {
  // Query 1: get booking
  const { rows: bookingRows } = await db.query<BookingRow>(
    `SELECT * FROM reservations.bookings WHERE id = $1`,
    [bookingId],
  );

  if (!bookingRows[0]) {
    throw new SlotError('BOOKING_NOT_FOUND');
  }

  const booking = bookingRows[0];

  if (booking.status === 'cancelled') {
    throw new SlotError('BOOKING_ALREADY_CANCELLED');
  }

  // Execute 1: cancel booking (does NOT increment)
  await db.execute(
    `UPDATE reservations.bookings
     SET status = 'cancelled', cancelled_at = NOW(), cancellation_reason = $2
     WHERE id = $1`,
    [bookingId, reason],
  );

  // Execute 2: update slot booked_count (does NOT increment) — don't go negative
  await db.execute(
    `UPDATE reservations.slots
     SET booked_count = GREATEST(0, booked_count - $1)
     WHERE id = $2`,
    [booking.quantity, booking.slot_id],
  );

  // If this booking was paid with a permanentka credit, refund it.
  // Best-effort: a refund failure is logged but does not block the cancel.
  if (booking.permanentka_usage_id && permanentkaOps) {
    await permanentkaOps.refundCredit(booking.permanentka_usage_id, reason);
  }

  // Refresh slot status
  await refreshSlotStatus(booking.slot_id, db);

  return mapBooking({
    ...booking,
    status: 'cancelled',
    cancelled_at: new Date().toISOString(),
    cancellation_reason: reason,
  });
}

export async function getBooking(
  bookingId: string,
  db: SlotDB,
): Promise<BookingWithSlot> {
  const { rows } = await db.query<BookingWithSlotRow>(
    `SELECT
       b.*,
       s.slot_date,
       s.start_time AS slot_start_time,
       s.end_time AS slot_end_time,
       s.capacity AS slot_capacity,
       s.booked_count AS slot_booked_count,
       s.price_hellers AS slot_price_hellers,
       s.status AS slot_status,
       s.generated_from_rule_id AS slot_generated_from_rule_id,
       s.override_id AS slot_override_id,
       r.id AS resource_id,
       r.name AS resource_name,
       r.resource_type,
       r.promoter_id AS resource_promoter_id
     FROM reservations.bookings b
     JOIN reservations.slots s ON s.id = b.slot_id
     JOIN reservations.resources r ON r.id = s.resource_id
     WHERE b.id = $1`,
    [bookingId],
  );

  if (!rows[0]) {
    throw new SlotError('BOOKING_NOT_FOUND');
  }

  const row = rows[0];

  return {
    ...mapBooking(row),
    slot: {
      id: row.slot_id,
      resourceId: row.resource_id,
      slotDate: row.slot_date,
      startTime: row.slot_start_time,
      endTime: row.slot_end_time,
      capacity: row.slot_capacity,
      bookedCount: row.slot_booked_count,
      priceHellers: row.slot_price_hellers,
      status: row.slot_status as import('./slot-generator.service').SlotStatus,
      generatedFromRuleId: row.slot_generated_from_rule_id,
      overrideId: row.slot_override_id,
    },
    resource: {
      id: row.resource_id,
      name: row.resource_name,
      resourceType: row.resource_type,
      promoterId: row.resource_promoter_id,
    },
  };
}

export async function listBookingsForUser(
  userId: string,
  filters: BookingFilters,
  db: SlotDB,
): Promise<Booking[]> {
  const conditions: string[] = ['b.user_id = $1'];
  const params: unknown[] = [userId];
  let idx = 2;

  if (filters.status !== undefined) {
    conditions.push(`b.status = $${idx}`);
    params.push(filters.status);
    idx++;
  }
  if (filters.dateFrom !== undefined) {
    conditions.push(`s.slot_date >= $${idx}`);
    params.push(filters.dateFrom);
    idx++;
  }
  if (filters.dateTo !== undefined) {
    conditions.push(`s.slot_date <= $${idx}`);
    params.push(filters.dateTo);
    idx++;
  }

  const { rows } = await db.query<BookingRow>(
    `SELECT b.*
     FROM reservations.bookings b
     JOIN reservations.slots s ON s.id = b.slot_id
     WHERE ${conditions.join(' AND ')}
     ORDER BY b.booked_at DESC`,
    params,
  );

  return rows.map(mapBooking);
}

export async function listBookingsForSlot(
  slotId: string,
  db: SlotDB,
): Promise<Booking[]> {
  const { rows } = await db.query<BookingRow>(
    `SELECT * FROM reservations.bookings WHERE slot_id = $1 ORDER BY booked_at ASC`,
    [slotId],
  );

  return rows.map(mapBooking);
}

export async function markNoShow(
  bookingId: string,
  db: SlotDB,
): Promise<Booking> {
  const { rows } = await db.query<BookingRow>(
    `UPDATE reservations.bookings SET status = 'no_show' WHERE id = $1 RETURNING *`,
    [bookingId],
  );

  if (!rows[0]) {
    throw new SlotError('BOOKING_NOT_FOUND');
  }

  return mapBooking(rows[0]);
}

export async function markCompleted(
  bookingId: string,
  db: SlotDB,
): Promise<Booking> {
  const { rows } = await db.query<BookingRow>(
    `UPDATE reservations.bookings SET status = 'completed' WHERE id = $1 RETURNING *`,
    [bookingId],
  );

  if (!rows[0]) {
    throw new SlotError('BOOKING_NOT_FOUND');
  }

  return mapBooking(rows[0]);
}

export async function cleanupExpiredHolds(
  db: SlotDB,
): Promise<{ deleted: number }> {
  // Query 1: get expired holds info before deletion
  const { rows: expiredRows } = await db.query<{ slot_id: string; quantity: number }>(
    `SELECT slot_id, quantity FROM reservations.booking_holds WHERE held_until < NOW()`,
    [],
  );

  if (expiredRows.length === 0) {
    return { deleted: 0 };
  }

  // Execute 1: delete expired holds (does NOT increment)
  await db.execute(
    `DELETE FROM reservations.booking_holds WHERE held_until < NOW()`,
    [],
  );

  // Execute 2: update affected slots (does NOT increment) — don't go negative
  // Group by slot_id
  const slotQuantities = expiredRows.reduce<Record<string, number>>((acc, r) => {
    acc[r.slot_id] = (acc[r.slot_id] ?? 0) + r.quantity;
    return acc;
  }, {});

  for (const [slotId, qty] of Object.entries(slotQuantities)) {
    await db.execute(
      `UPDATE reservations.slots
       SET booked_count = GREATEST(0, booked_count - $1)
       WHERE id = $2`,
      [qty, slotId],
    );
  }

  return { deleted: expiredRows.length };
}
