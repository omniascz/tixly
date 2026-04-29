/**
 * Open shifts — unassigned shifts that qualified staff can claim.
 *
 * Use case: promoter posts a shift without assigning a specific staff member.
 * Any active staff with the required role can claim it on first-come basis.
 */
import { StaffError } from '../lib/staff-errors.js';
import type { DbAdapter } from '../lib/service-container.js';
import type { StaffRole } from '../types/staff.js';

export interface OpenShift {
  id: string;
  promoterId: string;
  eventId: string;
  requiredRole: StaffRole;
  zone: string | null;
  startsAt: string;
  endsAt: string;
  hourlyRateHalire: number | null;
  slotsTotal: number;
  slotsClaimed: number;
  isActive: boolean;
  createdAt: string;
}

export interface CreateOpenShiftInput {
  eventId: string;
  requiredRole: StaffRole;
  zone?: string;
  startsAt: string;
  endsAt: string;
  hourlyRateHalire?: number;
  slotsTotal?: number;
}

export interface ServiceDeps {
  db: DbAdapter;
}

// ---------------------------------------------------------------------------
// Create open shift
// ---------------------------------------------------------------------------

export async function createOpenShift(
  promoterId: string,
  input: CreateOpenShiftInput,
  deps: ServiceDeps,
): Promise<OpenShift> {
  if (new Date(input.endsAt) <= new Date(input.startsAt)) {
    throw new StaffError('SHIFT_INVALID_TIME_RANGE');
  }

  const rows = await deps.db.query<OpenShift>(
    `INSERT INTO platform.staff_open_shifts
       (promoter_id, event_id, required_role, zone, starts_at, ends_at,
        hourly_rate_halire, slots_total)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
     RETURNING id, promoter_id AS "promoterId", event_id AS "eventId",
               required_role AS "requiredRole", zone,
               starts_at::text AS "startsAt", ends_at::text AS "endsAt",
               hourly_rate_halire AS "hourlyRateHalire",
               slots_total AS "slotsTotal", slots_claimed AS "slotsClaimed",
               is_active AS "isActive", created_at::text AS "createdAt"`,
    [promoterId, input.eventId, input.requiredRole, input.zone ?? null,
     input.startsAt, input.endsAt, input.hourlyRateHalire ?? null, input.slotsTotal ?? 1],
  );
  return rows[0];
}

export async function listOpenShifts(
  promoterId: string,
  eventId: string | undefined,
  deps: ServiceDeps,
): Promise<OpenShift[]> {
  const conds = ['promoter_id = $1', 'is_active = TRUE', 'slots_claimed < slots_total'];
  const params: unknown[] = [promoterId];
  if (eventId) { params.push(eventId); conds.push(`event_id = $${params.length}`); }

  return deps.db.query<OpenShift>(
    `SELECT id, promoter_id AS "promoterId", event_id AS "eventId",
            required_role AS "requiredRole", zone,
            starts_at::text AS "startsAt", ends_at::text AS "endsAt",
            hourly_rate_halire AS "hourlyRateHalire",
            slots_total AS "slotsTotal", slots_claimed AS "slotsClaimed",
            is_active AS "isActive", created_at::text AS "createdAt"
     FROM platform.staff_open_shifts
     WHERE ${conds.join(' AND ')}
     ORDER BY starts_at`,
    params,
  );
}

// ---------------------------------------------------------------------------
// Claim open shift — atomic increment + create shift
// ---------------------------------------------------------------------------

export async function claimOpenShift(
  openShiftId: string,
  staffId: string,
  promoterId: string,
  deps: ServiceDeps,
): Promise<{ openShift: OpenShift; shiftId: string }> {
  return deps.db.transaction(async (tx) => {
    // Lock the row and read slots
    const lockRows = await tx.query<{
      id: string; event_id: string; required_role: StaffRole; zone: string | null;
      starts_at: string; ends_at: string; slots_total: number; slots_claimed: number;
      is_active: boolean;
    }>(
      `SELECT id, event_id, required_role, zone, starts_at, ends_at,
              slots_total, slots_claimed, is_active
       FROM platform.staff_open_shifts
       WHERE id = $1 AND promoter_id = $2
       FOR UPDATE`,
      [openShiftId, promoterId],
    );
    if (lockRows.length === 0) throw new StaffError('OPEN_SHIFT_NOT_FOUND');
    const os = lockRows[0];
    if (!os.is_active || os.slots_claimed >= os.slots_total) {
      throw new StaffError('OPEN_SHIFT_ALREADY_CLAIMED');
    }

    // Verify staff is active and has the required role
    const roleRows = await tx.query<{ role: StaffRole }>(
      `SELECT sr.role FROM platform.staff_roles sr
       JOIN platform.staff_members sm ON sm.id = sr.staff_id
       WHERE sr.staff_id = $1 AND sm.promoter_id = $2 AND sm.status = 'active'`,
      [staffId, promoterId],
    );
    if (roleRows.length === 0) throw new StaffError('STAFF_INACTIVE');
    if (!roleRows.some((r) => r.role === os.required_role)) {
      throw new StaffError('STAFF_INVALID_ROLE', 'Zaměstnanec nemá požadovanou roli.');
    }

    // Check overlap with existing shifts
    const overlap = await tx.query<{ id: string }>(
      `SELECT id FROM platform.staff_shifts
       WHERE staff_id = $1 AND status NOT IN ('cancelled', 'no_show')
         AND starts_at < $2 AND ends_at > $3`,
      [staffId, os.ends_at, os.starts_at],
    );
    if (overlap.length > 0) throw new StaffError('SHIFT_OVERLAP');

    // Create the shift
    const shiftRows = await tx.query<{ id: string }>(
      `INSERT INTO platform.staff_shifts
         (promoter_id, event_id, staff_id, role, zone, starts_at, ends_at, status, notes)
       VALUES ($1, $2, $3, $4, $5, $6, $7, 'scheduled', $8)
       RETURNING id`,
      [promoterId, os.event_id, staffId, os.required_role, os.zone,
       os.starts_at, os.ends_at, 'Obsazeno z otevřené směny'],
    );

    // Increment claimed count
    const updated = await tx.query<OpenShift>(
      `UPDATE platform.staff_open_shifts
       SET slots_claimed = slots_claimed + 1
       WHERE id = $1
       RETURNING id, promoter_id AS "promoterId", event_id AS "eventId",
                 required_role AS "requiredRole", zone,
                 starts_at::text AS "startsAt", ends_at::text AS "endsAt",
                 hourly_rate_halire AS "hourlyRateHalire",
                 slots_total AS "slotsTotal", slots_claimed AS "slotsClaimed",
                 is_active AS "isActive", created_at::text AS "createdAt"`,
      [openShiftId],
    );

    return { openShift: updated[0], shiftId: shiftRows[0].id };
  });
}

export async function closeOpenShift(
  openShiftId: string,
  promoterId: string,
  deps: ServiceDeps,
): Promise<OpenShift> {
  const rows = await deps.db.query<OpenShift>(
    `UPDATE platform.staff_open_shifts
     SET is_active = FALSE
     WHERE id = $1 AND promoter_id = $2
     RETURNING id, promoter_id AS "promoterId", event_id AS "eventId",
               required_role AS "requiredRole", zone,
               starts_at::text AS "startsAt", ends_at::text AS "endsAt",
               hourly_rate_halire AS "hourlyRateHalire",
               slots_total AS "slotsTotal", slots_claimed AS "slotsClaimed",
               is_active AS "isActive", created_at::text AS "createdAt"`,
    [openShiftId, promoterId],
  );
  if (rows.length === 0) throw new StaffError('OPEN_SHIFT_NOT_FOUND');
  return rows[0];
}
