import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  createStaffMember,
  getStaffMember,
  listStaffMembers,
  updateStaffMember,
  archiveStaffMember,
  hasStaffPermission,
} from '../services/staff.service.js';
import { computeRolePermissions } from '../lib/role-permissions.js';
import { StaffError } from '../lib/staff-errors.js';
import type { ServiceDeps } from '../lib/service-container.js';

function makeDb() {
  const db: any = {
    query: vi.fn(),
    execute: vi.fn().mockResolvedValue(undefined),
    transaction: vi.fn(async (fn: any) => fn(db)),
  };
  return db;
}

function makeDeps(db: any): ServiceDeps {
  return { db };
}

const PROMOTER = 'p-1';
const STAFF_ID = 's-1';
const NOW = new Date('2026-04-08T12:00:00Z');

const baseRow = {
  id: STAFF_ID,
  promoter_id: PROMOTER,
  first_name: 'Jan',
  last_name: 'Novák',
  email: 'jan@example.com',
  phone: '+420777111222',
  emergency_contact: null,
  employment_type: 'employee',
  hourly_rate_halire: 15000,
  status: 'active',
  notes: null,
  created_at: NOW,
  updated_at: NOW,
};

describe('createStaffMember', () => {
  let db: any;
  beforeEach(() => {
    db = makeDb();
  });

  it('inserts member, roles, permissions; auto-derives permissions when not specified', async () => {
    db.query
      .mockResolvedValueOnce([]) // email uniqueness check
      .mockResolvedValueOnce([baseRow]); // INSERT RETURNING

    const result = await createStaffMember(
      PROMOTER,
      {
        firstName: 'Jan',
        lastName: 'Novák',
        email: 'jan@example.com',
        employmentType: 'employee',
        roles: ['security', 'usher'],
      },
      makeDeps(db),
    );

    expect(result.id).toBe(STAFF_ID);
    expect(result.roles).toEqual(['security', 'usher']);
    expect(result.permissions).toEqual(['scan_tickets']);
    // 2 role inserts + 1 permission insert
    const roleInserts = db.execute.mock.calls.filter((c: any[]) =>
      c[0].includes('staff_roles'),
    );
    expect(roleInserts).toHaveLength(2);
    const permInserts = db.execute.mock.calls.filter((c: any[]) =>
      c[0].includes('staff_permissions'),
    );
    expect(permInserts).toHaveLength(1);
  });

  it('throws STAFF_EMAIL_DUPLICATE when email already used in promoter', async () => {
    db.query.mockResolvedValueOnce([{ id: 'other' }]);

    await expect(
      createStaffMember(
        PROMOTER,
        {
          firstName: 'Jan',
          lastName: 'Novák',
          email: 'jan@example.com',
          employmentType: 'employee',
          roles: ['bar'],
        },
        makeDeps(db),
      ),
    ).rejects.toMatchObject({ code: 'STAFF_EMAIL_DUPLICATE' });
  });
});

describe('getStaffMember', () => {
  it('returns member with roles and permissions', async () => {
    const db = makeDb();
    db.query
      .mockResolvedValueOnce([baseRow]) // SELECT staff
      .mockResolvedValueOnce([{ role: 'security' }]) // roles
      .mockResolvedValueOnce([{ permission: 'scan_tickets' }]); // perms

    const result = await getStaffMember(STAFF_ID, PROMOTER, makeDeps(db));
    expect(result.id).toBe(STAFF_ID);
    expect(result.roles).toEqual(['security']);
    expect(result.permissions).toEqual(['scan_tickets']);
  });

  it('throws STAFF_NOT_FOUND for wrong promoter (anti-enumeration)', async () => {
    const db = makeDb();
    db.query.mockResolvedValueOnce([]);
    await expect(
      getStaffMember(STAFF_ID, 'wrong-promoter', makeDeps(db)),
    ).rejects.toMatchObject({ code: 'STAFF_NOT_FOUND' });
  });
});

describe('listStaffMembers', () => {
  it('filters by status/role/search and paginates', async () => {
    const db = makeDb();
    db.query
      .mockResolvedValueOnce([{ count: '1' }]) // total
      .mockResolvedValueOnce([baseRow]) // page rows
      .mockResolvedValueOnce([{ role: 'security' }])
      .mockResolvedValueOnce([{ permission: 'scan_tickets' }]);

    const result = await listStaffMembers(
      PROMOTER,
      { status: 'active', role: 'security', search: 'Jan' },
      { limit: 10, offset: 0 },
      makeDeps(db),
    );

    expect(result.total).toBe(1);
    expect(result.items).toHaveLength(1);
    // first call is COUNT, validate filter SQL fragments present
    const countSql = db.query.mock.calls[0][0];
    expect(countSql).toContain('promoter_id');
    expect(countSql).toContain('status');
    expect(countSql).toContain('staff_roles');
    expect(countSql).toContain('ILIKE');
  });
});

describe('updateStaffMember', () => {
  it('changing roles updates permissions when not explicitly set', async () => {
    const db = makeDb();
    db.query
      .mockResolvedValueOnce([baseRow]) // existing check
      .mockResolvedValueOnce([baseRow]) // refresh in tx
      .mockResolvedValueOnce([{ role: 'manager' }]) // roles
      .mockResolvedValueOnce([
        { permission: 'scan_tickets' },
        { permission: 'will_call_pickup' },
        { permission: 'guest_list_check_in' },
        { permission: 'manage_orders' },
        { permission: 'view_revenue' },
        { permission: 'manage_staff' },
      ]);

    const result = await updateStaffMember(
      STAFF_ID,
      PROMOTER,
      { roles: ['manager'] },
      makeDeps(db),
    );

    expect(result.roles).toEqual(['manager']);
    expect(result.permissions).toContain('manage_staff');
    // verify that staff_permissions DELETE happened (recompute)
    const deleteCalls = db.execute.mock.calls.filter(
      (c: any[]) => c[0].includes('DELETE') && c[0].includes('staff_permissions'),
    );
    expect(deleteCalls.length).toBeGreaterThan(0);
  });
});

describe('archiveStaffMember', () => {
  it('sets status=archived, does not delete row', async () => {
    const db = makeDb();
    db.query.mockResolvedValueOnce([{ id: STAFF_ID }]);

    await archiveStaffMember(STAFF_ID, PROMOTER, makeDeps(db));

    const updateCall = db.execute.mock.calls.find((c: any[]) =>
      c[0].includes('UPDATE platform.staff_members'),
    );
    expect(updateCall).toBeDefined();
    expect(updateCall[0]).toContain("status = 'archived'");
    const deleteCall = db.execute.mock.calls.find((c: any[]) =>
      c[0].includes('DELETE FROM platform.staff_members'),
    );
    expect(deleteCall).toBeUndefined();
  });

  it('throws STAFF_NOT_FOUND for wrong promoter', async () => {
    const db = makeDb();
    db.query.mockResolvedValueOnce([]);
    await expect(
      archiveStaffMember(STAFF_ID, 'wrong', makeDeps(db)),
    ).rejects.toMatchObject({ code: 'STAFF_NOT_FOUND' });
  });
});

describe('hasStaffPermission', () => {
  it('returns true when permission granted', async () => {
    const db = makeDb();
    db.query.mockResolvedValueOnce([{ exists: 1 }]);
    const result = await hasStaffPermission(STAFF_ID, 'scan_tickets', makeDeps(db));
    expect(result).toBe(true);
  });

  it('returns false when not granted', async () => {
    const db = makeDb();
    db.query.mockResolvedValueOnce([]);
    const result = await hasStaffPermission(STAFF_ID, 'manage_staff', makeDeps(db));
    expect(result).toBe(false);
  });
});

describe('computeRolePermissions', () => {
  it('returns union of multiple roles default permissions', async () => {
    const perms = computeRolePermissions(['security', 'ticket_check']);
    expect(perms).toContain('scan_tickets');
    expect(perms).toContain('guest_list_check_in');
    // no duplicates
    expect(new Set(perms).size).toBe(perms.length);
  });

  it('returns empty for roles with no defaults', async () => {
    const perms = computeRolePermissions(['bar', 'cleaning', 'other']);
    expect(perms).toEqual([]);
  });

  it('manager has all permissions', async () => {
    const perms = computeRolePermissions(['manager']);
    expect(perms).toHaveLength(6);
  });
});
