/**
 * Staff availability service — manages periods when staff is unavailable
 * (vacation, sick leave, personal time).
 *
 * Shift creation should check availability to prevent scheduling conflicts.
 */
import { StaffError } from '../lib/staff-errors.js';
import type { DbAdapter } from '../lib/service-container.js';

export type AvailabilityReason = 'vacation' | 'sick' | 'personal' | 'other';

export interface AvailabilityBlock {
  id: string;
  staffId: string;
  promoterId: string;
  startsAt: string;       // ISO timestamp
  endsAt: string;
  reason: AvailabilityReason;
  notes: string | null;
  approved: boolean;
  createdAt: string;
}

export interface CreateAvailabilityInput {
  startsAt: string;
  endsAt: string;
  reason: AvailabilityReason;
  notes?: string;
}

export interface ServiceDeps {
  db: DbAdapter;
}

// ---------------------------------------------------------------------------
// Create availability block
// ---------------------------------------------------------------------------

export async function createAvailabilityBlock(
  staffId: string,
  promoterId: string,
  input: CreateAvailabilityInput,
  deps: ServiceDeps,
): Promise<AvailabilityBlock> {
  const start = new Date(input.startsAt);
  const end = new Date(input.endsAt);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime()) || end <= start) {
    throw new StaffError('AVAILABILITY_INVALID_RANGE');
  }

  // Verify staff belongs to promoter
  const staffRows = await deps.db.query<{ id: string; status: string }>(
    `SELECT id, status FROM platform.staff_members
     WHERE id = $1 AND promoter_id = $2`,
    [staffId, promoterId],
  );
  if (staffRows.length === 0) throw new StaffError('STAFF_NOT_FOUND');
  if (staffRows[0].status === 'archived') throw new StaffError('STAFF_INACTIVE');

  const rows = await deps.db.query<AvailabilityBlock>(
    `INSERT INTO platform.staff_availability
       (staff_id, promoter_id, starts_at, ends_at, reason, notes)
     VALUES ($1, $2, $3, $4, $5, $6)
     RETURNING id, staff_id AS "staffId", promoter_id AS "promoterId",
               starts_at::text AS "startsAt", ends_at::text AS "endsAt",
               reason, notes, approved, created_at::text AS "createdAt"`,
    [staffId, promoterId, input.startsAt, input.endsAt, input.reason, input.notes ?? null],
  );
  return rows[0];
}

// ---------------------------------------------------------------------------
// Read + list
// ---------------------------------------------------------------------------

export async function getAvailabilityBlock(
  blockId: string,
  promoterId: string,
  deps: ServiceDeps,
): Promise<AvailabilityBlock> {
  const rows = await deps.db.query<AvailabilityBlock>(
    `SELECT id, staff_id AS "staffId", promoter_id AS "promoterId",
            starts_at::text AS "startsAt", ends_at::text AS "endsAt",
            reason, notes, approved, created_at::text AS "createdAt"
     FROM platform.staff_availability
     WHERE id = $1 AND promoter_id = $2`,
    [blockId, promoterId],
  );
  if (rows.length === 0) throw new StaffError('AVAILABILITY_NOT_FOUND');
  return rows[0];
}

export async function listAvailabilityForStaff(
  staffId: string,
  promoterId: string,
  from: string | undefined,
  to: string | undefined,
  deps: ServiceDeps,
): Promise<AvailabilityBlock[]> {
  const conds = ['staff_id = $1', 'promoter_id = $2'];
  const params: unknown[] = [staffId, promoterId];
  if (from) { params.push(from); conds.push(`ends_at >= $${params.length}`); }
  if (to) { params.push(to); conds.push(`starts_at <= $${params.length}`); }

  return deps.db.query<AvailabilityBlock>(
    `SELECT id, staff_id AS "staffId", promoter_id AS "promoterId",
            starts_at::text AS "startsAt", ends_at::text AS "endsAt",
            reason, notes, approved, created_at::text AS "createdAt"
     FROM platform.staff_availability
     WHERE ${conds.join(' AND ')}
     ORDER BY starts_at`,
    params,
  );
}

// ---------------------------------------------------------------------------
// Approval + deletion
// ---------------------------------------------------------------------------

export async function approveAvailability(
  blockId: string,
  promoterId: string,
  deps: ServiceDeps,
): Promise<AvailabilityBlock> {
  const rows = await deps.db.query<AvailabilityBlock>(
    `UPDATE platform.staff_availability
     SET approved = TRUE
     WHERE id = $1 AND promoter_id = $2
     RETURNING id, staff_id AS "staffId", promoter_id AS "promoterId",
               starts_at::text AS "startsAt", ends_at::text AS "endsAt",
               reason, notes, approved, created_at::text AS "createdAt"`,
    [blockId, promoterId],
  );
  if (rows.length === 0) throw new StaffError('AVAILABILITY_NOT_FOUND');
  return rows[0];
}

export async function deleteAvailability(
  blockId: string,
  promoterId: string,
  deps: ServiceDeps,
): Promise<void> {
  const rows = await deps.db.query<{ id: string }>(
    `DELETE FROM platform.staff_availability
     WHERE id = $1 AND promoter_id = $2
     RETURNING id`,
    [blockId, promoterId],
  );
  if (rows.length === 0) throw new StaffError('AVAILABILITY_NOT_FOUND');
}

// ---------------------------------------------------------------------------
// Conflict check — called by shift creation
// ---------------------------------------------------------------------------

/**
 * Returns true if the staff has any APPROVED availability block
 * that overlaps with [startsAt, endsAt].
 */
export async function hasAvailabilityConflict(
  staffId: string,
  startsAt: string,
  endsAt: string,
  deps: ServiceDeps,
): Promise<boolean> {
  const rows = await deps.db.query<{ cnt: string }>(
    `SELECT COUNT(*) AS cnt FROM platform.staff_availability
     WHERE staff_id = $1
       AND approved = TRUE
       AND starts_at < $3
       AND ends_at > $2`,
    [staffId, startsAt, endsAt],
  );
  return parseInt(rows[0]?.cnt ?? '0', 10) > 0;
}
