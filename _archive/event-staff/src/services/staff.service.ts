// -- Required schema (add via migration before deploying):
// -- CREATE TABLE platform.staff_members (
// --   id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
// --   promoter_id UUID NOT NULL REFERENCES platform.promoters(id),
// --   first_name TEXT NOT NULL,
// --   last_name TEXT NOT NULL,
// --   email TEXT,
// --   phone TEXT,
// --   emergency_contact TEXT,
// --   employment_type TEXT NOT NULL,
// --   hourly_rate_halire INTEGER,
// --   status TEXT NOT NULL DEFAULT 'active',
// --   notes TEXT,
// --   created_at TIMESTAMPTZ DEFAULT NOW(),
// --   updated_at TIMESTAMPTZ DEFAULT NOW(),
// --   UNIQUE (promoter_id, email)
// -- );
// -- CREATE TABLE platform.staff_roles (
// --   staff_id UUID NOT NULL REFERENCES platform.staff_members(id) ON DELETE CASCADE,
// --   role TEXT NOT NULL,
// --   PRIMARY KEY (staff_id, role)
// -- );
// -- CREATE TABLE platform.staff_permissions (
// --   staff_id UUID NOT NULL REFERENCES platform.staff_members(id) ON DELETE CASCADE,
// --   permission TEXT NOT NULL,
// --   PRIMARY KEY (staff_id, permission)
// -- );
// -- CREATE INDEX idx_staff_members_promoter ON platform.staff_members(promoter_id);
// -- CREATE INDEX idx_staff_members_status ON platform.staff_members(promoter_id, status);

import type { ServiceDeps } from '../lib/service-container.js';
import type { DbAdapter } from '@tixly/db-adapter';
import { StaffError } from '../lib/staff-errors.js';
import { computeRolePermissions } from '../lib/role-permissions.js';
import type {
  StaffMember,
  StaffMemberWithRoles,
  StaffRole,
  StaffStatus,
  StaffPermission,
  CreateStaffMemberInput,
  UpdateStaffMemberInput,
} from '../types/staff.js';

interface StaffMemberRow {
  id: string;
  promoter_id: string;
  first_name: string;
  last_name: string;
  email: string | null;
  phone: string | null;
  emergency_contact: string | null;
  employment_type: string;
  hourly_rate_halire: number | null;
  status: string;
  notes: string | null;
  created_at: Date;
  updated_at: Date;
}

function mapRow(row: StaffMemberRow): StaffMember {
  return {
    id: row.id,
    promoterId: row.promoter_id,
    firstName: row.first_name,
    lastName: row.last_name,
    email: row.email,
    phone: row.phone,
    emergencyContact: row.emergency_contact,
    employmentType: row.employment_type as StaffMember['employmentType'],
    hourlyRateHalire: row.hourly_rate_halire,
    status: row.status as StaffStatus,
    notes: row.notes,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

async function loadRolesAndPermissions(
  staffId: string,
  db: DbAdapter,
): Promise<{ roles: StaffRole[]; permissions: StaffPermission[] }> {
  const roleRows = await db.query<{ role: string }>(
    'SELECT role FROM platform.staff_roles WHERE staff_id = $1',
    [staffId],
  );
  const permRows = await db.query<{ permission: string }>(
    'SELECT permission FROM platform.staff_permissions WHERE staff_id = $1',
    [staffId],
  );
  return {
    roles: roleRows.map((r) => r.role as StaffRole),
    permissions: permRows.map((r) => r.permission as StaffPermission),
  };
}

export async function createStaffMember(
  promoterId: string,
  input: CreateStaffMemberInput,
  deps: ServiceDeps,
): Promise<StaffMemberWithRoles> {
  if (!input.roles || input.roles.length === 0) {
    throw new StaffError('STAFF_INVALID_ROLE');
  }

  // Email uniqueness check (within promoter)
  if (input.email) {
    const existing = await deps.db.query<{ id: string }>(
      'SELECT id FROM platform.staff_members WHERE promoter_id = $1 AND email = $2',
      [promoterId, input.email],
    );
    if (existing.length > 0) {
      throw new StaffError('STAFF_EMAIL_DUPLICATE');
    }
  }

  const permissions =
    input.permissions && input.permissions.length > 0
      ? input.permissions
      : computeRolePermissions(input.roles);

  return deps.db.transaction(async (tx) => {
    const inserted = await tx.query<StaffMemberRow>(
      `INSERT INTO platform.staff_members
         (promoter_id, first_name, last_name, email, phone, emergency_contact,
          employment_type, hourly_rate_halire, notes)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
       RETURNING *`,
      [
        promoterId,
        input.firstName,
        input.lastName,
        input.email ?? null,
        input.phone ?? null,
        input.emergencyContact ?? null,
        input.employmentType,
        input.hourlyRateHalire ?? null,
        input.notes ?? null,
      ],
    );

    const row = inserted[0];
    if (!row) throw new StaffError('STAFF_NOT_FOUND');

    for (const role of input.roles) {
      await tx.execute(
        'INSERT INTO platform.staff_roles (staff_id, role) VALUES ($1, $2)',
        [row.id, role],
      );
    }
    for (const perm of permissions) {
      await tx.execute(
        'INSERT INTO platform.staff_permissions (staff_id, permission) VALUES ($1, $2)',
        [row.id, perm],
      );
    }

    const member = mapRow(row);
    return { ...member, roles: input.roles, permissions };
  });
}

export async function getStaffMember(
  staffId: string,
  promoterId: string,
  deps: ServiceDeps,
): Promise<StaffMemberWithRoles> {
  const rows = await deps.db.query<StaffMemberRow>(
    'SELECT * FROM platform.staff_members WHERE id = $1 AND promoter_id = $2',
    [staffId, promoterId],
  );
  const row = rows[0];
  if (!row) throw new StaffError('STAFF_NOT_FOUND');

  const member = mapRow(row);
  const { roles, permissions } = await loadRolesAndPermissions(row.id, deps.db);
  return { ...member, roles, permissions };
}

export async function listStaffMembers(
  promoterId: string,
  filters: { status?: StaffStatus; role?: StaffRole; search?: string },
  pagination: { limit?: number; offset?: number },
  deps: ServiceDeps,
): Promise<{ items: StaffMemberWithRoles[]; total: number }> {
  const conditions: string[] = ['sm.promoter_id = $1'];
  const params: unknown[] = [promoterId];
  let idx = 2;

  if (filters.status) {
    conditions.push(`sm.status = $${idx++}`);
    params.push(filters.status);
  }
  if (filters.role) {
    conditions.push(
      `EXISTS (SELECT 1 FROM platform.staff_roles sr WHERE sr.staff_id = sm.id AND sr.role = $${idx++})`,
    );
    params.push(filters.role);
  }
  if (filters.search) {
    conditions.push(
      `((sm.first_name || ' ' || sm.last_name) ILIKE $${idx} OR sm.email ILIKE $${idx})`,
    );
    params.push(`%${filters.search}%`);
    idx++;
  }

  const where = conditions.join(' AND ');

  const totalRows = await deps.db.query<{ count: string }>(
    `SELECT COUNT(*)::text AS count FROM platform.staff_members sm WHERE ${where}`,
    params,
  );
  const total = Number(totalRows[0]?.count ?? '0');

  const limit = pagination.limit ?? 50;
  const offset = pagination.offset ?? 0;

  const rows = await deps.db.query<StaffMemberRow>(
    `SELECT sm.* FROM platform.staff_members sm
     WHERE ${where}
     ORDER BY sm.created_at DESC
     LIMIT $${idx++} OFFSET $${idx++}`,
    [...params, limit, offset],
  );

  const items: StaffMemberWithRoles[] = [];
  for (const row of rows) {
    const member = mapRow(row);
    const rp = await loadRolesAndPermissions(row.id, deps.db);
    items.push({ ...member, ...rp });
  }

  return { items, total };
}

export async function updateStaffMember(
  staffId: string,
  promoterId: string,
  input: UpdateStaffMemberInput,
  deps: ServiceDeps,
): Promise<StaffMemberWithRoles> {
  // Verify ownership (anti-enumeration: 404 not 403)
  const existing = await deps.db.query<StaffMemberRow>(
    'SELECT * FROM platform.staff_members WHERE id = $1 AND promoter_id = $2',
    [staffId, promoterId],
  );
  if (existing.length === 0) throw new StaffError('STAFF_NOT_FOUND');

  // Email uniqueness if changing
  if (input.email) {
    const dupes = await deps.db.query<{ id: string }>(
      'SELECT id FROM platform.staff_members WHERE promoter_id = $1 AND email = $2 AND id <> $3',
      [promoterId, input.email, staffId],
    );
    if (dupes.length > 0) throw new StaffError('STAFF_EMAIL_DUPLICATE');
  }

  return deps.db.transaction(async (tx) => {
    const sets: string[] = [];
    const params: unknown[] = [];
    let idx = 1;

    const fieldMap: Array<[keyof UpdateStaffMemberInput, string]> = [
      ['firstName', 'first_name'],
      ['lastName', 'last_name'],
      ['email', 'email'],
      ['phone', 'phone'],
      ['emergencyContact', 'emergency_contact'],
      ['employmentType', 'employment_type'],
      ['hourlyRateHalire', 'hourly_rate_halire'],
      ['status', 'status'],
      ['notes', 'notes'],
    ];

    for (const [key, col] of fieldMap) {
      if (input[key] !== undefined) {
        sets.push(`${col} = $${idx++}`);
        params.push(input[key]);
      }
    }

    if (sets.length > 0) {
      sets.push(`updated_at = NOW()`);
      params.push(staffId, promoterId);
      await tx.execute(
        `UPDATE platform.staff_members SET ${sets.join(', ')} WHERE id = $${idx++} AND promoter_id = $${idx++}`,
        params,
      );
    }

    if (input.roles !== undefined) {
      await tx.execute('DELETE FROM platform.staff_roles WHERE staff_id = $1', [staffId]);
      for (const role of input.roles) {
        await tx.execute(
          'INSERT INTO platform.staff_roles (staff_id, role) VALUES ($1, $2)',
          [staffId, role],
        );
      }

      // If permissions not explicitly set, recompute defaults from new roles
      if (input.permissions === undefined) {
        const newPerms = computeRolePermissions(input.roles);
        await tx.execute('DELETE FROM platform.staff_permissions WHERE staff_id = $1', [staffId]);
        for (const perm of newPerms) {
          await tx.execute(
            'INSERT INTO platform.staff_permissions (staff_id, permission) VALUES ($1, $2)',
            [staffId, perm],
          );
        }
      }
    }

    if (input.permissions !== undefined) {
      await tx.execute('DELETE FROM platform.staff_permissions WHERE staff_id = $1', [staffId]);
      for (const perm of input.permissions) {
        await tx.execute(
          'INSERT INTO platform.staff_permissions (staff_id, permission) VALUES ($1, $2)',
          [staffId, perm],
        );
      }
    }

    const refreshed = await tx.query<StaffMemberRow>(
      'SELECT * FROM platform.staff_members WHERE id = $1 AND promoter_id = $2',
      [staffId, promoterId],
    );
    const row = refreshed[0];
    if (!row) throw new StaffError('STAFF_NOT_FOUND');

    const member = mapRow(row);
    const rp = await loadRolesAndPermissions(staffId, tx);
    return { ...member, ...rp };
  });
}

export async function archiveStaffMember(
  staffId: string,
  promoterId: string,
  deps: ServiceDeps,
): Promise<void> {
  const existing = await deps.db.query<{ id: string }>(
    'SELECT id FROM platform.staff_members WHERE id = $1 AND promoter_id = $2',
    [staffId, promoterId],
  );
  if (existing.length === 0) throw new StaffError('STAFF_NOT_FOUND');

  await deps.db.execute(
    `UPDATE platform.staff_members
     SET status = 'archived', updated_at = NOW()
     WHERE id = $1 AND promoter_id = $2`,
    [staffId, promoterId],
  );
}

/** Check if a staff member has a specific permission. Used by other modules. */
export async function hasStaffPermission(
  staffId: string,
  permission: StaffPermission,
  deps: ServiceDeps,
): Promise<boolean> {
  const rows = await deps.db.query<{ exists: number }>(
    `SELECT 1 AS exists FROM platform.staff_permissions
     WHERE staff_id = $1 AND permission = $2`,
    [staffId, permission],
  );
  return rows.length > 0;
}
