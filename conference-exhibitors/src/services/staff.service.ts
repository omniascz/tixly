// =============================================================================
// Exhibitor Staff Service
// =============================================================================

import { ExhibitorError, isPgUniqueViolation } from '../lib/exhibitor-errors';

// ---------------------------------------------------------------------------
// DB adapter
// ---------------------------------------------------------------------------

export interface StaffDB {
  query<T>(sql: string, params?: unknown[]): Promise<T[]>;
  execute(sql: string, params?: unknown[]): Promise<void>;
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type StaffRole = 'manager' | 'staff' | 'presenter';

export interface AddStaffInput {
  fullName: string;
  email: string;
  phone?: string;
  role?: StaffRole;
}

export interface UpdateStaffInput {
  fullName?: string;
  phone?: string;
  role?: StaffRole;
}

export interface Staff {
  id: string;
  exhibitorId: string;
  fullName: string;
  email: string;
  phone: string | null;
  role: StaffRole;
  badgePrinted: boolean;
  accessToken: string;
  createdAt: string;
}

export interface StaffWithExhibitor extends Staff {
  exhibitorName: string;
  conferenceId: string;
}

// ---------------------------------------------------------------------------
// Row types
// ---------------------------------------------------------------------------

interface StaffRow {
  id: string;
  exhibitor_id: string;
  full_name: string;
  email: string;
  phone: string | null;
  role: string;
  badge_printed: boolean;
  access_token: string;
  created_at: string;
}

interface StaffWithExhibitorRow extends StaffRow {
  company_name: string;
  conference_id: string;
}

// ---------------------------------------------------------------------------
// Mappers
// ---------------------------------------------------------------------------

function mapStaff(row: StaffRow): Staff {
  return {
    id: row.id,
    exhibitorId: row.exhibitor_id,
    fullName: row.full_name,
    email: row.email,
    phone: row.phone,
    role: row.role as StaffRole,
    badgePrinted: row.badge_printed,
    accessToken: row.access_token,
    createdAt: row.created_at,
  };
}

function mapStaffWithExhibitor(row: StaffWithExhibitorRow): StaffWithExhibitor {
  return {
    ...mapStaff(row),
    exhibitorName: row.company_name,
    conferenceId: row.conference_id,
  };
}

// ---------------------------------------------------------------------------
// 1. addStaff
// ---------------------------------------------------------------------------

export async function addStaff(
  exhibitorId: string,
  input: AddStaffInput,
  db: StaffDB,
): Promise<Staff> {
  try {
    const [row] = await db.query<StaffRow>(
      `INSERT INTO conference.exhibitor_staff
         (exhibitor_id, full_name, email, phone, role)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING *`,
      [
        exhibitorId,
        input.fullName,
        input.email,
        input.phone ?? null,
        input.role ?? 'staff',
      ],
    );
    return mapStaff(row);
  } catch (err) {
    if (isPgUniqueViolation(err)) throw new ExhibitorError('STAFF_DUPLICATE');
    throw err;
  }
}

// ---------------------------------------------------------------------------
// 2. getStaff
// ---------------------------------------------------------------------------

export async function getStaff(
  staffId: string,
  db: StaffDB,
): Promise<Staff> {
  const [row] = await db.query<StaffRow>(
    `SELECT * FROM conference.exhibitor_staff WHERE id = $1`,
    [staffId],
  );
  if (!row) throw new ExhibitorError('STAFF_NOT_FOUND');
  return mapStaff(row);
}

// ---------------------------------------------------------------------------
// 3. listStaff
// ---------------------------------------------------------------------------

export async function listStaff(
  exhibitorId: string,
  db: StaffDB,
): Promise<Staff[]> {
  const rows = await db.query<StaffRow>(
    `SELECT * FROM conference.exhibitor_staff WHERE exhibitor_id = $1 ORDER BY created_at ASC`,
    [exhibitorId],
  );
  return rows.map(mapStaff);
}

// ---------------------------------------------------------------------------
// 4. updateStaff
// ---------------------------------------------------------------------------

export async function updateStaff(
  staffId: string,
  input: UpdateStaffInput,
  db: StaffDB,
): Promise<Staff> {
  const sets: string[] = [];
  const values: unknown[] = [];
  let idx = 1;

  if (input.fullName !== undefined) { sets.push(`full_name = $${idx++}`); values.push(input.fullName); }
  if (input.phone !== undefined) { sets.push(`phone = $${idx++}`); values.push(input.phone); }
  if (input.role !== undefined) { sets.push(`role = $${idx++}`); values.push(input.role); }

  if (sets.length === 0) return getStaff(staffId, db);

  values.push(staffId);
  const [row] = await db.query<StaffRow>(
    `UPDATE conference.exhibitor_staff SET ${sets.join(', ')} WHERE id = $${idx} RETURNING *`,
    values,
  );
  if (!row) throw new ExhibitorError('STAFF_NOT_FOUND');
  return mapStaff(row);
}

// ---------------------------------------------------------------------------
// 5. removeStaff
// ---------------------------------------------------------------------------

export async function removeStaff(
  staffId: string,
  db: StaffDB,
): Promise<void> {
  await db.execute(
    `DELETE FROM conference.exhibitor_staff WHERE id = $1`,
    [staffId],
  );
}

// ---------------------------------------------------------------------------
// 6. markBadgePrinted
// ---------------------------------------------------------------------------

export async function markBadgePrinted(
  staffId: string,
  db: StaffDB,
): Promise<Staff> {
  const [row] = await db.query<StaffRow>(
    `UPDATE conference.exhibitor_staff SET badge_printed = true WHERE id = $1 RETURNING *`,
    [staffId],
  );
  if (!row) throw new ExhibitorError('STAFF_NOT_FOUND');
  return mapStaff(row);
}

// ---------------------------------------------------------------------------
// 7. verifyStaffAccess
// ---------------------------------------------------------------------------

export async function verifyStaffAccess(
  accessToken: string,
  db: StaffDB,
): Promise<StaffWithExhibitor | null> {
  const [row] = await db.query<StaffWithExhibitorRow>(
    `SELECT es.*, e.company_name, e.conference_id
     FROM conference.exhibitor_staff es
     JOIN conference.exhibitors e ON e.id = es.exhibitor_id
     WHERE es.access_token = $1`,
    [accessToken],
  );
  if (!row) return null;
  return mapStaffWithExhibitor(row);
}
