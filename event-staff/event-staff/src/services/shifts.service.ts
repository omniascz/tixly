// SQL schema required (see migration 061_staff_shifts.sql):
// CREATE TABLE platform.staff_shifts (
//   id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
//   promoter_id UUID NOT NULL,
//   event_id UUID NOT NULL,
//   staff_id UUID NOT NULL REFERENCES platform.staff_members(id),
//   role TEXT NOT NULL,
//   zone TEXT,
//   starts_at TIMESTAMPTZ NOT NULL,
//   ends_at TIMESTAMPTZ NOT NULL,
//   status TEXT NOT NULL DEFAULT 'scheduled',
//   notes TEXT,
//   actual_starts_at TIMESTAMPTZ,
//   actual_ends_at TIMESTAMPTZ,
//   payout_halire INTEGER,
//   created_at TIMESTAMPTZ DEFAULT NOW(),
//   updated_at TIMESTAMPTZ DEFAULT NOW(),
//   CHECK (ends_at > starts_at)
// );

import type { ServiceDeps, DbAdapter } from '../lib/service-container.js';
import { StaffError } from '../lib/staff-errors.js';
import type {
  Shift,
  ShiftStatus,
  ShiftWithStaff,
  StaffRole,
  CreateShiftInput,
  BulkCreateShiftsInput,
  UpdateShiftInput,
  ShiftTimelineSlot,
} from '../types/staff.js';

interface ShiftRow {
  id: string;
  promoter_id: string;
  event_id: string;
  staff_id: string;
  role: string;
  zone: string | null;
  starts_at: Date;
  ends_at: Date;
  status: string;
  notes: string | null;
  actual_starts_at: Date | null;
  actual_ends_at: Date | null;
  payout_halire: number | null;
  created_at: Date;
  updated_at: Date;
}

interface ShiftWithStaffRow extends ShiftRow {
  first_name: string;
  last_name: string;
  phone: string | null;
}

function mapShift(row: ShiftRow): Shift {
  return {
    id: row.id,
    promoterId: row.promoter_id,
    eventId: row.event_id,
    staffId: row.staff_id,
    role: row.role as StaffRole,
    zone: row.zone,
    startsAt: row.starts_at,
    endsAt: row.ends_at,
    status: row.status as ShiftStatus,
    notes: row.notes,
    actualStartsAt: row.actual_starts_at,
    actualEndsAt: row.actual_ends_at,
    payoutHalire: row.payout_halire,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function mapShiftWithStaff(row: ShiftWithStaffRow): ShiftWithStaff {
  return {
    ...mapShift(row),
    staffFirstName: row.first_name,
    staffLastName: row.last_name,
    staffPhone: row.phone,
  };
}

/** status transitions: terminal states (completed, cancelled, no_show) cannot move to non-terminal */
const ALLOWED_TRANSITIONS: Record<ShiftStatus, ShiftStatus[]> = {
  scheduled: ['confirmed', 'in_progress', 'cancelled', 'no_show'],
  confirmed: ['scheduled', 'in_progress', 'cancelled', 'no_show'],
  in_progress: ['completed', 'cancelled', 'no_show'],
  completed: [],
  cancelled: [],
  no_show: [],
};

function assertTransition(from: ShiftStatus, to: ShiftStatus): void {
  if (from === to) return;
  if (!ALLOWED_TRANSITIONS[from].includes(to)) {
    throw new StaffError('SHIFT_INVALID_STATUS_TRANSITION');
  }
}

function validateTimeRange(startsAtIso: string, endsAtIso: string): { startsAt: Date; endsAt: Date } {
  const startsAt = new Date(startsAtIso);
  const endsAt = new Date(endsAtIso);
  if (
    Number.isNaN(startsAt.getTime()) ||
    Number.isNaN(endsAt.getTime()) ||
    startsAt.getTime() >= endsAt.getTime()
  ) {
    throw new StaffError('SHIFT_INVALID_TIME_RANGE');
  }
  return { startsAt, endsAt };
}

async function assertStaffBelongsToPromoter(
  staffId: string,
  promoterId: string,
  db: DbAdapter,
): Promise<{ id: string; hourly_rate_halire: number | null }> {
  const rows = await db.query<{ id: string; hourly_rate_halire: number | null }>(
    `SELECT id, hourly_rate_halire FROM platform.staff_members
     WHERE id = $1 AND promoter_id = $2 AND status <> 'archived'`,
    [staffId, promoterId],
  );
  const row = rows[0];
  if (!row) throw new StaffError('STAFF_NOT_FOUND');
  return row;
}

async function findOverlap(
  staffId: string,
  startsAt: Date,
  endsAt: Date,
  excludeShiftId: string | null,
  db: DbAdapter,
): Promise<boolean> {
  const params: unknown[] = [staffId, startsAt.toISOString(), endsAt.toISOString()];
  let sql = `SELECT id FROM platform.staff_shifts
             WHERE staff_id = $1
               AND status NOT IN ('cancelled', 'no_show')
               AND (starts_at, ends_at) OVERLAPS ($2::timestamptz, $3::timestamptz)`;
  if (excludeShiftId) {
    sql += ` AND id <> $4`;
    params.push(excludeShiftId);
  }
  sql += ` LIMIT 1`;
  const rows = await db.query<{ id: string }>(sql, params);
  return rows.length > 0;
}

export async function createShift(
  promoterId: string,
  eventId: string,
  input: CreateShiftInput,
  deps: ServiceDeps,
): Promise<Shift> {
  const { startsAt, endsAt } = validateTimeRange(input.startsAt, input.endsAt);

  await assertStaffBelongsToPromoter(input.staffId, promoterId, deps.db);

  const overlaps = await findOverlap(input.staffId, startsAt, endsAt, null, deps.db);
  if (overlaps) throw new StaffError('SHIFT_OVERLAP');

  const inserted = await deps.db.query<ShiftRow>(
    `INSERT INTO platform.staff_shifts
       (promoter_id, event_id, staff_id, role, zone, starts_at, ends_at, notes)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
     RETURNING *`,
    [
      promoterId,
      eventId,
      input.staffId,
      input.role,
      input.zone ?? null,
      startsAt.toISOString(),
      endsAt.toISOString(),
      input.notes ?? null,
    ],
  );

  const row = inserted[0];
  if (!row) throw new StaffError('SHIFT_NOT_FOUND');
  return mapShift(row);
}

export async function bulkCreateShifts(
  promoterId: string,
  eventId: string,
  input: BulkCreateShiftsInput,
  deps: ServiceDeps,
): Promise<{
  created: Shift[];
  conflicts: Array<{ staffId: string; reason: 'overlap' | 'inactive' | 'not_found' }>;
}> {
  const { startsAt, endsAt } = validateTimeRange(input.startsAt, input.endsAt);

  const created: Shift[] = [];
  const conflicts: Array<{ staffId: string; reason: 'overlap' | 'inactive' | 'not_found' }> = [];

  return deps.db.transaction(async (tx) => {
    for (const staffId of input.staffIds) {
      try {
        await assertStaffBelongsToPromoter(staffId, promoterId, tx);
      } catch {
        conflicts.push({ staffId, reason: 'not_found' });
        continue;
      }

      const overlaps = await findOverlap(staffId, startsAt, endsAt, null, tx);
      if (overlaps) {
        conflicts.push({ staffId, reason: 'overlap' });
        continue;
      }

      const inserted = await tx.query<ShiftRow>(
        `INSERT INTO platform.staff_shifts
           (promoter_id, event_id, staff_id, role, zone, starts_at, ends_at, notes)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
         RETURNING *`,
        [
          promoterId,
          eventId,
          staffId,
          input.role,
          input.zone ?? null,
          startsAt.toISOString(),
          endsAt.toISOString(),
          input.notes ?? null,
        ],
      );
      const row = inserted[0];
      if (row) created.push(mapShift(row));
    }

    return { created, conflicts };
  });
}

async function loadShiftRow(
  shiftId: string,
  promoterId: string,
  db: DbAdapter,
): Promise<ShiftRow> {
  const rows = await db.query<ShiftRow>(
    `SELECT * FROM platform.staff_shifts WHERE id = $1 AND promoter_id = $2`,
    [shiftId, promoterId],
  );
  const row = rows[0];
  if (!row) throw new StaffError('SHIFT_NOT_FOUND');
  return row;
}

export async function getShift(
  shiftId: string,
  promoterId: string,
  deps: ServiceDeps,
): Promise<ShiftWithStaff> {
  const rows = await deps.db.query<ShiftWithStaffRow>(
    `SELECT s.*, sm.first_name, sm.last_name, sm.phone
     FROM platform.staff_shifts s
     JOIN platform.staff_members sm ON sm.id = s.staff_id
     WHERE s.id = $1 AND s.promoter_id = $2`,
    [shiftId, promoterId],
  );
  const row = rows[0];
  if (!row) throw new StaffError('SHIFT_NOT_FOUND');
  return mapShiftWithStaff(row);
}

export async function listShiftsForEvent(
  eventId: string,
  promoterId: string,
  deps: ServiceDeps,
): Promise<ShiftWithStaff[]> {
  const rows = await deps.db.query<ShiftWithStaffRow>(
    `SELECT s.*, sm.first_name, sm.last_name, sm.phone
     FROM platform.staff_shifts s
     JOIN platform.staff_members sm ON sm.id = s.staff_id
     WHERE s.event_id = $1 AND s.promoter_id = $2
     ORDER BY s.starts_at ASC`,
    [eventId, promoterId],
  );
  return rows.map(mapShiftWithStaff);
}

export async function listShiftsForStaff(
  staffId: string,
  promoterId: string,
  filters: { from?: Date; to?: Date; status?: ShiftStatus },
  deps: ServiceDeps,
): Promise<Shift[]> {
  const conditions: string[] = ['staff_id = $1', 'promoter_id = $2'];
  const params: unknown[] = [staffId, promoterId];
  let idx = 3;

  if (filters.from) {
    conditions.push(`ends_at >= $${idx++}`);
    params.push(filters.from.toISOString());
  }
  if (filters.to) {
    conditions.push(`starts_at <= $${idx++}`);
    params.push(filters.to.toISOString());
  }
  if (filters.status) {
    conditions.push(`status = $${idx++}`);
    params.push(filters.status);
  }

  const rows = await deps.db.query<ShiftRow>(
    `SELECT * FROM platform.staff_shifts
     WHERE ${conditions.join(' AND ')}
     ORDER BY starts_at ASC`,
    params,
  );
  return rows.map(mapShift);
}

export async function updateShift(
  shiftId: string,
  promoterId: string,
  input: UpdateShiftInput,
  deps: ServiceDeps,
): Promise<Shift> {
  const existing = await loadShiftRow(shiftId, promoterId, deps.db);

  let newStartsAt: Date | undefined;
  let newEndsAt: Date | undefined;
  if (input.startsAt !== undefined || input.endsAt !== undefined) {
    const startIso = input.startsAt ?? existing.starts_at.toISOString();
    const endIso = input.endsAt ?? existing.ends_at.toISOString();
    const validated = validateTimeRange(startIso, endIso);
    newStartsAt = validated.startsAt;
    newEndsAt = validated.endsAt;

    const overlaps = await findOverlap(
      existing.staff_id,
      newStartsAt,
      newEndsAt,
      shiftId,
      deps.db,
    );
    if (overlaps) throw new StaffError('SHIFT_OVERLAP');
  }

  if (input.status !== undefined) {
    assertTransition(existing.status as ShiftStatus, input.status);
  }

  const sets: string[] = [];
  const params: unknown[] = [];
  let idx = 1;

  if (input.role !== undefined) {
    sets.push(`role = $${idx++}`);
    params.push(input.role);
  }
  if (input.zone !== undefined) {
    sets.push(`zone = $${idx++}`);
    params.push(input.zone);
  }
  if (newStartsAt) {
    sets.push(`starts_at = $${idx++}`);
    params.push(newStartsAt.toISOString());
  }
  if (newEndsAt) {
    sets.push(`ends_at = $${idx++}`);
    params.push(newEndsAt.toISOString());
  }
  if (input.status !== undefined) {
    sets.push(`status = $${idx++}`);
    params.push(input.status);
  }
  if (input.notes !== undefined) {
    sets.push(`notes = $${idx++}`);
    params.push(input.notes);
  }

  if (sets.length === 0) {
    return mapShift(existing);
  }

  sets.push(`updated_at = NOW()`);
  params.push(shiftId, promoterId);

  const updated = await deps.db.query<ShiftRow>(
    `UPDATE platform.staff_shifts SET ${sets.join(', ')}
     WHERE id = $${idx++} AND promoter_id = $${idx++}
     RETURNING *`,
    params,
  );
  const row = updated[0];
  if (!row) throw new StaffError('SHIFT_NOT_FOUND');
  return mapShift(row);
}

export async function cancelShift(
  shiftId: string,
  promoterId: string,
  deps: ServiceDeps,
): Promise<Shift> {
  const existing = await loadShiftRow(shiftId, promoterId, deps.db);
  assertTransition(existing.status as ShiftStatus, 'cancelled');

  const updated = await deps.db.query<ShiftRow>(
    `UPDATE platform.staff_shifts
     SET status = 'cancelled', updated_at = NOW()
     WHERE id = $1 AND promoter_id = $2
     RETURNING *`,
    [shiftId, promoterId],
  );
  const row = updated[0];
  if (!row) throw new StaffError('SHIFT_NOT_FOUND');
  return mapShift(row);
}

export async function checkInShift(
  shiftId: string,
  promoterId: string,
  deps: ServiceDeps,
): Promise<Shift> {
  const existing = await loadShiftRow(shiftId, promoterId, deps.db);
  const status = existing.status as ShiftStatus;
  if (status !== 'scheduled' && status !== 'confirmed') {
    throw new StaffError('SHIFT_INVALID_STATUS_TRANSITION');
  }

  const updated = await deps.db.query<ShiftRow>(
    `UPDATE platform.staff_shifts
     SET status = 'in_progress', actual_starts_at = NOW(), updated_at = NOW()
     WHERE id = $1 AND promoter_id = $2
     RETURNING *`,
    [shiftId, promoterId],
  );
  const row = updated[0];
  if (!row) throw new StaffError('SHIFT_NOT_FOUND');
  return mapShift(row);
}

export async function checkOutShift(
  shiftId: string,
  promoterId: string,
  deps: ServiceDeps,
): Promise<Shift> {
  const existing = await loadShiftRow(shiftId, promoterId, deps.db);
  if ((existing.status as ShiftStatus) !== 'in_progress') {
    throw new StaffError('SHIFT_INVALID_STATUS_TRANSITION');
  }

  const staffRows = await deps.db.query<{ hourly_rate_halire: number | null }>(
    `SELECT hourly_rate_halire FROM platform.staff_members WHERE id = $1`,
    [existing.staff_id],
  );
  const hourlyRate = staffRows[0]?.hourly_rate_halire ?? 0;

  const actualEndsAt = new Date();
  const startReference = existing.actual_starts_at ?? existing.starts_at;
  const workedMs = actualEndsAt.getTime() - startReference.getTime();
  const workedHours = workedMs / (1000 * 60 * 60);
  const payoutHalire = Math.round(workedHours * hourlyRate);

  const updated = await deps.db.query<ShiftRow>(
    `UPDATE platform.staff_shifts
     SET status = 'completed',
         actual_ends_at = $1,
         payout_halire = $2,
         updated_at = NOW()
     WHERE id = $3 AND promoter_id = $4
     RETURNING *`,
    [actualEndsAt.toISOString(), payoutHalire, shiftId, promoterId],
  );
  const row = updated[0];
  if (!row) throw new StaffError('SHIFT_NOT_FOUND');
  return mapShift(row);
}

export async function getEventShiftTimeline(
  eventId: string,
  promoterId: string,
  deps: ServiceDeps,
): Promise<ShiftTimelineSlot[]> {
  const shifts = await listShiftsForEvent(eventId, promoterId, deps);

  const buckets = new Map<string, ShiftWithStaff[]>();
  for (const shift of shifts) {
    const date = shift.startsAt.toISOString().slice(0, 10); // YYYY-MM-DD UTC
    const bucket = buckets.get(date);
    if (bucket) {
      bucket.push(shift);
    } else {
      buckets.set(date, [shift]);
    }
  }

  const slots: ShiftTimelineSlot[] = Array.from(buckets.entries())
    .map(([date, slotShifts]) => ({
      date,
      shifts: slotShifts.sort((a, b) => a.startsAt.getTime() - b.startsAt.getTime()),
    }))
    .sort((a, b) => a.date.localeCompare(b.date));

  return slots;
}
