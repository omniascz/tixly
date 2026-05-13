import { EntryError } from '../lib/entry-errors';
import type { EntryDB } from './venue.service';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type SlotStatus = 'available' | 'full' | 'closed' | 'cancelled';

export interface EntrySlot {
  id: string;
  venueId: string;
  slotDate: string;
  entryTime: string;
  exitTime: string;
  capacity: number;
  bookedCount: number;
  status: SlotStatus;
  notes: string | null;
}

export interface CreateSlotInput {
  slotDate: string;
  entryTime: string;
  exitTime: string;
  capacity: number;
  notes?: string;
}

// ---------------------------------------------------------------------------
// Row mapper
// ---------------------------------------------------------------------------

function rowToSlot(row: Record<string, unknown>): EntrySlot {
  return {
    id: row.id as string,
    venueId: row.venue_id as string,
    slotDate: row.slot_date as string,
    entryTime: row.entry_time as string,
    exitTime: row.exit_time as string,
    capacity: row.capacity as number,
    bookedCount: row.booked_count as number,
    status: row.status as SlotStatus,
    notes: (row.notes as string | null) ?? null,
  };
}

// ---------------------------------------------------------------------------
// createEntrySlot
// ---------------------------------------------------------------------------

export async function createEntrySlot(
  venueId: string,
  input: CreateSlotInput,
  db: EntryDB,
): Promise<EntrySlot> {
  const { rows } = await db.query<Record<string, unknown>>(
    `INSERT INTO venues.entry_slots (venue_id, slot_date, entry_time, exit_time, capacity, notes)
     VALUES ($1,$2,$3,$4,$5,$6)
     RETURNING *`,
    [venueId, input.slotDate, input.entryTime, input.exitTime, input.capacity, input.notes ?? null],
  );

  if (!rows[0]) {
    throw new EntryError('SLOT_NOT_FOUND');
  }

  return rowToSlot(rows[0]);
}

// ---------------------------------------------------------------------------
// getSlot
// ---------------------------------------------------------------------------

export async function getSlot(slotId: string, db: EntryDB): Promise<EntrySlot> {
  const { rows } = await db.query<Record<string, unknown>>(
    `SELECT * FROM venues.entry_slots WHERE id = $1`,
    [slotId],
  );

  if (!rows[0]) {
    throw new EntryError('SLOT_NOT_FOUND');
  }

  return rowToSlot(rows[0]);
}

// ---------------------------------------------------------------------------
// listSlots
// ---------------------------------------------------------------------------

export async function listSlots(
  venueId: string,
  date: string,
  db: EntryDB,
): Promise<EntrySlot[]> {
  const { rows } = await db.query<Record<string, unknown>>(
    `SELECT * FROM venues.entry_slots WHERE venue_id = $1 AND slot_date = $2 ORDER BY entry_time`,
    [venueId, date],
  );

  return rows.map(rowToSlot);
}

// ---------------------------------------------------------------------------
// getAvailableSlots
// ---------------------------------------------------------------------------

export async function getAvailableSlots(
  venueId: string,
  dateFrom: string,
  dateTo: string,
  db: EntryDB,
): Promise<EntrySlot[]> {
  const { rows } = await db.query<Record<string, unknown>>(
    `SELECT * FROM venues.entry_slots
     WHERE venue_id = $1
       AND status = 'available'
       AND slot_date BETWEEN $2 AND $3
     ORDER BY slot_date, entry_time`,
    [venueId, dateFrom, dateTo],
  );

  return rows.map(rowToSlot);
}

// ---------------------------------------------------------------------------
// bulkCreateSlots
// ---------------------------------------------------------------------------

export async function bulkCreateSlots(
  venueId: string,
  slotsArray: CreateSlotInput[],
  db: EntryDB,
): Promise<EntrySlot[]> {
  if (slotsArray.length === 0) return [];

  const valuePlaceholders: string[] = [];
  const params: unknown[] = [];
  let idx = 1;

  for (const slot of slotsArray) {
    valuePlaceholders.push(`($${idx},$${idx + 1},$${idx + 2},$${idx + 3},$${idx + 4},$${idx + 5})`);
    params.push(venueId, slot.slotDate, slot.entryTime, slot.exitTime, slot.capacity, slot.notes ?? null);
    idx += 6;
  }

  const { rows } = await db.query<Record<string, unknown>>(
    `INSERT INTO venues.entry_slots (venue_id, slot_date, entry_time, exit_time, capacity, notes)
     VALUES ${valuePlaceholders.join(',')}
     ON CONFLICT DO NOTHING
     RETURNING *`,
    params,
  );

  return rows.map(rowToSlot);
}

// ---------------------------------------------------------------------------
// closeSlot
// ---------------------------------------------------------------------------

export async function closeSlot(slotId: string, db: EntryDB): Promise<EntrySlot> {
  const { rows } = await db.query<Record<string, unknown>>(
    `UPDATE venues.entry_slots SET status = 'closed' WHERE id = $1 RETURNING *`,
    [slotId],
  );

  if (!rows[0]) {
    throw new EntryError('SLOT_NOT_FOUND');
  }

  return rowToSlot(rows[0]);
}

// ---------------------------------------------------------------------------
// updateSlotCapacity
// ---------------------------------------------------------------------------

export async function updateSlotCapacity(
  slotId: string,
  newCapacity: number,
  db: EntryDB,
): Promise<EntrySlot> {
  const { rows } = await db.query<Record<string, unknown>>(
    `UPDATE venues.entry_slots
     SET capacity = $1,
         status = CASE
           WHEN booked_count >= $1 THEN 'full'
           WHEN status = 'full' AND booked_count < $1 THEN 'available'
           ELSE status
         END
     WHERE id = $2 AND booked_count <= $1
     RETURNING *`,
    [newCapacity, slotId],
  );

  if (!rows[0]) {
    throw new EntryError('SLOT_NOT_FOUND');
  }

  return rowToSlot(rows[0]);
}
