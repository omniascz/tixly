// =============================================================================
// Holds & Kills Service — Seat-Level Reservation for Seat Map
// Feature #39: Hold seats for production/artist/sponsor (releasable)
//              or Kill seats permanently (structural/sightline issues)
//
// Distinction from inventory-holdback:
//   - inventory-holdback: reserves a quantity of ticket_types (bucket-level)
//   - holds/kills: operates on individual seat IDs in the seat map
// =============================================================================

export interface DbAdapter {
  query<T>(sql: string, params?: unknown[]): Promise<T[]>;
  execute(sql: string, params?: unknown[]): Promise<void>;
}

export type HoldType = 'hold' | 'kill';
export type HoldCategory = 'production' | 'artist' | 'sponsor' | 'press' | 'accessibility' | 'venue' | 'other';

export interface SeatHold {
  id: string;
  eventId: string;
  seatId: string;
  holdType: HoldType;
  category: HoldCategory;
  label: string | null;
  heldBy: string;
  notes: string | null;
  releasedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

interface HoldRow {
  id: string;
  event_id: string;
  seat_id: string;
  hold_type: string;
  category: string;
  label: string | null;
  held_by: string;
  notes: string | null;
  released_at: string | null;
  created_at: string;
  updated_at: string;
}

function mapHold(r: HoldRow): SeatHold {
  return {
    id: r.id,
    eventId: r.event_id,
    seatId: r.seat_id,
    holdType: r.hold_type as HoldType,
    category: r.category as HoldCategory,
    label: r.label,
    heldBy: r.held_by,
    notes: r.notes,
    releasedAt: r.released_at,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

/**
 * Place a hold on a seat (releasable reservation).
 * Throws SEAT_ALREADY_HELD if an active hold/kill exists for this seat.
 */
export async function holdSeat(
  eventId: string,
  seatId: string,
  category: HoldCategory,
  heldBy: string,
  label: string | null,
  notes: string | null,
  db: DbAdapter,
): Promise<SeatHold> {
  if (!seatId || !eventId) {
    throw new Error('VALIDATION_ERROR: eventId and seatId are required');
  }

  // Check for existing active hold/kill
  const existing = await db.query<HoldRow>(
    `SELECT * FROM seat_holds.seat_holds WHERE event_id = $1 AND seat_id = $2 AND released_at IS NULL`,
    [eventId, seatId],
  );

  if (existing[0]) {
    throw new Error(`SEAT_ALREADY_HELD: seat ${seatId} has an active ${existing[0].hold_type}`);
  }

  const rows = await db.query<HoldRow>(
    `INSERT INTO seat_holds.seat_holds (event_id, seat_id, hold_type, category, label, held_by, notes)
     VALUES ($1, $2, 'hold', $3, $4, $5, $6)
     RETURNING *`,
    [eventId, seatId, category, label, heldBy, notes],
  );

  return mapHold(rows[0]);
}

/**
 * Kill a seat (permanent removal from sale — cannot be released).
 * Useful for: camera platforms, structural obstructions, sightline issues.
 */
export async function killSeat(
  eventId: string,
  seatId: string,
  category: HoldCategory,
  heldBy: string,
  label: string | null,
  notes: string | null,
  db: DbAdapter,
): Promise<SeatHold> {
  if (!seatId || !eventId) {
    throw new Error('VALIDATION_ERROR: eventId and seatId are required');
  }

  const existing = await db.query<HoldRow>(
    `SELECT * FROM seat_holds.seat_holds WHERE event_id = $1 AND seat_id = $2 AND released_at IS NULL`,
    [eventId, seatId],
  );

  if (existing[0]) {
    throw new Error(`SEAT_ALREADY_HELD: seat ${seatId} has an active ${existing[0].hold_type}`);
  }

  const rows = await db.query<HoldRow>(
    `INSERT INTO seat_holds.seat_holds (event_id, seat_id, hold_type, category, label, held_by, notes)
     VALUES ($1, $2, 'kill', $3, $4, $5, $6)
     RETURNING *`,
    [eventId, seatId, category, label, heldBy, notes],
  );

  return mapHold(rows[0]);
}

/**
 * Release a hold (make seat available again).
 * Kills cannot be released — use this only for holds.
 */
export async function releaseHold(
  holdId: string,
  eventId: string,
  db: DbAdapter,
): Promise<SeatHold> {
  const rows = await db.query<HoldRow>(
    `UPDATE seat_holds.seat_holds
     SET released_at = NOW(), updated_at = NOW()
     WHERE id = $1
       AND event_id = $2
       AND hold_type = 'hold'
       AND released_at IS NULL
     RETURNING *`,
    [holdId, eventId],
  );

  if (!rows[0]) {
    throw new Error('HOLD_NOT_FOUND: hold does not exist, is already released, or is a kill');
  }

  return mapHold(rows[0]);
}

/**
 * Get all active holds and kills for an event.
 * Used by seat-map rendering to mark held/killed seats.
 */
export async function getActiveHolds(
  eventId: string,
  db: DbAdapter,
): Promise<SeatHold[]> {
  const rows = await db.query<HoldRow>(
    `SELECT * FROM seat_holds.seat_holds
     WHERE event_id = $1 AND released_at IS NULL
     ORDER BY created_at ASC`,
    [eventId],
  );
  return rows.map(mapHold);
}

/**
 * Get hold/kill status for a specific seat.
 */
export async function getSeatHoldStatus(
  eventId: string,
  seatId: string,
  db: DbAdapter,
): Promise<SeatHold | null> {
  const rows = await db.query<HoldRow>(
    `SELECT * FROM seat_holds.seat_holds
     WHERE event_id = $1 AND seat_id = $2 AND released_at IS NULL`,
    [eventId, seatId],
  );
  return rows[0] ? mapHold(rows[0]) : null;
}

/**
 * Bulk hold seats (e.g., artist rider requests a block of seats).
 */
export async function bulkHoldSeats(
  eventId: string,
  seatIds: string[],
  category: HoldCategory,
  heldBy: string,
  label: string | null,
  db: DbAdapter,
): Promise<{ held: SeatHold[]; failed: Array<{ seatId: string; reason: string }> }> {
  const held: SeatHold[] = [];
  const failed: Array<{ seatId: string; reason: string }> = [];

  for (const seatId of seatIds) {
    try {
      const h = await holdSeat(eventId, seatId, category, heldBy, label, null, db);
      held.push(h);
    } catch (err) {
      failed.push({ seatId, reason: err instanceof Error ? err.message : 'UNKNOWN_ERROR' });
    }
  }

  return { held, failed };
}
