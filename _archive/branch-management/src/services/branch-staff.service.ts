import { BranchError } from '../lib/branch-errors';
import type { BranchDB } from './branch.service';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type StaffRole = 'manager' | 'staff' | 'receptionist' | 'instructor' | 'viewer';

export interface StaffInput {
  hiredAt?: string | null;
  notes?: string | null;
}

export interface BranchStaff {
  id: string;
  branchId: string;
  userId: string;
  role: StaffRole;
  isActive: boolean;
  hiredAt: string | null;
  notes: string | null;
  createdAt: string;
}

export interface StaffFilters {
  role?: StaffRole;
  isActive?: boolean;
}

// ---------------------------------------------------------------------------
// Row types
// ---------------------------------------------------------------------------

interface StaffRow {
  id: string;
  branch_id: string;
  user_id: string;
  role: StaffRole;
  is_active: boolean;
  hired_at: string | null;
  notes: string | null;
  created_at: string;
}

// ---------------------------------------------------------------------------
// Role hierarchy
// ---------------------------------------------------------------------------

const ROLE_LEVEL: Record<StaffRole, number> = {
  manager: 100,
  staff: 50,
  receptionist: 50,
  instructor: 50,
  viewer: 10,
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function mapStaff(row: StaffRow): BranchStaff {
  return {
    id: row.id,
    branchId: row.branch_id,
    userId: row.user_id,
    role: row.role,
    isActive: row.is_active,
    hiredAt: row.hired_at,
    notes: row.notes,
    createdAt: row.created_at,
  };
}

// ---------------------------------------------------------------------------
// Functions
// ---------------------------------------------------------------------------

export async function addStaff(
  branchId: string,
  userId: string,
  role: StaffRole,
  input: StaffInput,
  db: BranchDB,
): Promise<BranchStaff> {
  const { rows } = await db.query<StaffRow>(
    `INSERT INTO reservations.branch_staff (branch_id, user_id, role, hired_at, notes)
     VALUES ($1, $2, $3, $4, $5)
     RETURNING *`,
    [branchId, userId, role, input.hiredAt ?? null, input.notes ?? null],
  );

  if (!rows[0]) {
    throw new BranchError('STAFF_DUPLICATE');
  }

  return mapStaff(rows[0]);
}

export async function getStaff(
  staffId: string,
  db: BranchDB,
): Promise<BranchStaff> {
  const { rows } = await db.query<StaffRow>(
    `SELECT * FROM reservations.branch_staff WHERE id = $1`,
    [staffId],
  );

  if (!rows[0]) {
    throw new BranchError('STAFF_NOT_FOUND');
  }

  return mapStaff(rows[0]);
}

export async function listStaff(
  branchId: string,
  filters: StaffFilters,
  db: BranchDB,
): Promise<BranchStaff[]> {
  const conditions: string[] = ['branch_id = $1'];
  const params: unknown[] = [branchId];
  let idx = 2;

  if (filters.role !== undefined) {
    conditions.push(`role = $${idx}`);
    params.push(filters.role);
    idx++;
  }
  if (filters.isActive !== undefined) {
    conditions.push(`is_active = $${idx}`);
    params.push(filters.isActive);
    idx++;
  }

  const { rows } = await db.query<StaffRow>(
    `SELECT * FROM reservations.branch_staff
     WHERE ${conditions.join(' AND ')}
     ORDER BY created_at ASC`,
    params,
  );

  return rows.map(mapStaff);
}

export async function updateStaffRole(
  staffId: string,
  role: StaffRole,
  db: BranchDB,
): Promise<BranchStaff> {
  const { rows } = await db.query<StaffRow>(
    `UPDATE reservations.branch_staff
     SET role = $1
     WHERE id = $2
     RETURNING *`,
    [role, staffId],
  );

  if (!rows[0]) {
    throw new BranchError('STAFF_NOT_FOUND');
  }

  return mapStaff(rows[0]);
}

export async function removeStaff(
  staffId: string,
  db: BranchDB,
): Promise<void> {
  await db.execute(
    `UPDATE reservations.branch_staff SET is_active = false WHERE id = $1`,
    [staffId],
  );
}

export async function getStaffBranches(
  userId: string,
  db: BranchDB,
): Promise<BranchStaff[]> {
  const { rows } = await db.query<StaffRow>(
    `SELECT * FROM reservations.branch_staff
     WHERE user_id = $1 AND is_active = true
     ORDER BY created_at ASC`,
    [userId],
  );

  return rows.map(mapStaff);
}

export async function hasPermission(
  userId: string,
  branchId: string,
  requiredRole: StaffRole,
  db: BranchDB,
): Promise<boolean> {
  const { rows } = await db.query<{ role: StaffRole; is_active: boolean }>(
    `SELECT role, is_active FROM reservations.branch_staff
     WHERE user_id = $1 AND branch_id = $2`,
    [userId, branchId],
  );

  if (!rows[0] || !rows[0].is_active) {
    return false;
  }

  const userLevel = ROLE_LEVEL[rows[0].role];
  const requiredLevel = ROLE_LEVEL[requiredRole];

  return userLevel >= requiredLevel;
}
