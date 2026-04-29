import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { DbAdapter } from '../lib/types.js';

import {
  listTenants,
  getTenant,
  suspendTenant,
  reactivateTenant,
  updateTenantFee,
  deleteTenant,
} from '../services/tenant-management.service.js';

import {
  createImpersonationToken,
  verifyImpersonationToken,
  revokeImpersonationToken,
  listActiveImpersonations,
} from '../services/impersonation.service.js';

import {
  logAdminAction,
  getAuditLog,
} from '../services/platform-audit.service.js';

import {
  getPlatformOverview,
  getRevenueStats,
} from '../services/platform-overview.service.js';

// ---------------------------------------------------------------------------
// Mock factory
// ---------------------------------------------------------------------------

/**
 * Creates a mock DbAdapter where each query() call returns the next response
 * from the responses array in order. execute() is a no-op by default unless
 * executeResponses is provided.
 */
function makeDb(
  queryResponses: unknown[][] = [],
  executeResponses: Array<() => Promise<void>> = [],
): { db: DbAdapter; query: ReturnType<typeof vi.fn>; execute: ReturnType<typeof vi.fn> } {
  let qi = 0;
  let ei = 0;
  const query = vi.fn(async () => queryResponses[qi++] ?? []);
  const execute = vi.fn(async () => {
    const fn = executeResponses[ei++];
    if (fn) await fn();
  });
  const db: DbAdapter = {
    query,
    execute,
    transaction: async (fn) => fn({ query, execute, transaction: db.transaction }),
  };
  return { db, query, execute };
}

// ---------------------------------------------------------------------------
// Shared fixture builders
// ---------------------------------------------------------------------------

const TENANT_ID = 'tenant-uuid-0001';
const ADMIN_ID = 'admin-uuid-0001';
const PROMOTER_ID = 'promoter-uuid-0002';

function makeTenantRow(overrides: Record<string, unknown> = {}) {
  return {
    id: TENANT_ID,
    name: 'Acme Events',
    email: 'acme@example.com',
    status: 'active',
    platform_fee_percent: '3.5',
    created_at: '2026-01-01T00:00:00Z',
    total_revenue: '500000',
    total_orders: '42',
    total_count: '10',
    ...overrides,
  };
}

function makeAuditRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'audit-uuid-0001',
    admin_id: ADMIN_ID,
    action: 'suspend_tenant',
    target_type: 'tenant',
    target_id: TENANT_ID,
    details: null,
    ip_address: null,
    created_at: '2026-04-18T10:00:00Z',
    total_count: '1',
    ...overrides,
  };
}

function makeImpersonationRow(overrides: Record<string, unknown> = {}) {
  return {
    token: 'a'.repeat(64),
    admin_id: ADMIN_ID,
    target_promoter_id: PROMOTER_ID,
    expires_at: new Date(Date.now() + 3_600_000).toISOString(),
    revoked_at: null,
    created_at: '2026-04-18T10:00:00Z',
    ...overrides,
  };
}

// ===========================================================================
// 1–3: listTenants
// ===========================================================================

describe('listTenants', () => {
  it('1. vrátí paginated výsledky', async () => {
    const rows = [makeTenantRow(), makeTenantRow({ id: 'tenant-uuid-0002', total_count: '2' })];
    // listTenants makes 1 query; suspendTenant calls logAdminAction which makes another query
    const { db } = makeDb([rows]);

    const result = await listTenants({}, db);

    expect(result.tenants).toHaveLength(2);
    expect(result.total).toBe(10);
    expect(result.tenants[0].id).toBe(TENANT_ID);
    expect(result.tenants[0].platformFeePercent).toBe(3.5);
  });

  it('2. filtruje podle status="active"', async () => {
    const rows = [makeTenantRow()];
    const { db, query } = makeDb([rows]);

    await listTenants({ status: 'active' }, db);

    const sql: string = query.mock.calls[0][0];
    expect(sql).toContain("p.status = $");
    const params: unknown[] = query.mock.calls[0][1];
    expect(params).toContain('active');
  });

  it('3. filtruje podle search (name/email)', async () => {
    const rows = [makeTenantRow()];
    const { db, query } = makeDb([rows]);

    await listTenants({ search: 'acme' }, db);

    const sql: string = query.mock.calls[0][0];
    expect(sql).toContain('ILIKE');
    const params: unknown[] = query.mock.calls[0][1];
    expect(params).toContain('%acme%');
  });
});

// ===========================================================================
// 4–5: getTenant
// ===========================================================================

describe('getTenant', () => {
  it('4. vrátí detail tenanta se statistikami', async () => {
    const { db } = makeDb([[makeTenantRow()]]);

    const tenant = await getTenant(TENANT_ID, db);

    expect(tenant.id).toBe(TENANT_ID);
    expect(tenant.totalRevenue).toBe(500000);
    expect(tenant.totalOrders).toBe(42);
  });

  it('5. hodí error pro neexistující tenant', async () => {
    const { db } = makeDb([[]]); // empty result

    await expect(getTenant('nonexistent-id', db)).rejects.toThrow('not found');
  });
});

// ===========================================================================
// 6–7: suspendTenant
// ===========================================================================

describe('suspendTenant', () => {
  it('6. UPDATE status na "suspended", volá logAdminAction', async () => {
    // Query calls: 1) SELECT status, 2) logAdminAction INSERT
    const { db, execute, query } = makeDb(
      [
        [{ status: 'active' }],   // status check
        [makeAuditRow()],          // logAdminAction INSERT
      ],
    );

    await suspendTenant(TENANT_ID, 'Porušení podmínek', ADMIN_ID, db);

    expect(execute).toHaveBeenCalledWith(
      expect.stringContaining("'suspended'"),
      expect.arrayContaining([TENANT_ID]),
    );
    // logAdminAction calls db.query with INSERT
    expect(query).toHaveBeenCalledTimes(2);
  });

  it('7. hodí error pokud tenant již suspended', async () => {
    const { db } = makeDb([[{ status: 'suspended' }]]);

    await expect(
      suspendTenant(TENANT_ID, 'Duplicate suspend', ADMIN_ID, db),
    ).rejects.toThrow('already suspended');
  });
});

// ===========================================================================
// 8: reactivateTenant
// ===========================================================================

describe('reactivateTenant', () => {
  it('8. UPDATE status na "active"', async () => {
    const { db, execute, query } = makeDb([[makeAuditRow()]]);

    await reactivateTenant(TENANT_ID, ADMIN_ID, db);

    expect(execute).toHaveBeenCalledWith(
      expect.stringContaining("'active'"),
      expect.arrayContaining([TENANT_ID]),
    );
    expect(query).toHaveBeenCalledTimes(1); // logAdminAction
  });
});

// ===========================================================================
// 9–11: updateTenantFee
// ===========================================================================

describe('updateTenantFee', () => {
  it('9. validuje rozsah 0-100%, UPDATE platform_fee_percent', async () => {
    const { db, execute, query } = makeDb([[makeAuditRow()]]);

    await updateTenantFee(TENANT_ID, 5.0, ADMIN_ID, db);

    expect(execute).toHaveBeenCalledWith(
      expect.stringContaining('platform_fee_percent'),
      expect.arrayContaining([5.0, TENANT_ID]),
    );
    expect(query).toHaveBeenCalledTimes(1); // logAdminAction
  });

  it('10. hodí error pro fee > 100', async () => {
    const { db } = makeDb([]);

    await expect(
      updateTenantFee(TENANT_ID, 101, ADMIN_ID, db),
    ).rejects.toThrow('cannot exceed 100');
  });

  it('11. hodí error pro fee < 0', async () => {
    const { db } = makeDb([]);

    await expect(
      updateTenantFee(TENANT_ID, -1, ADMIN_ID, db),
    ).rejects.toThrow('cannot be negative');
  });
});

// ===========================================================================
// 12: deleteTenant
// ===========================================================================

describe('deleteTenant', () => {
  it('12. UPDATE status na "deleted"', async () => {
    const { db, execute, query } = makeDb([[makeAuditRow()]]);

    await deleteTenant(TENANT_ID, ADMIN_ID, db);

    expect(execute).toHaveBeenCalledWith(
      expect.stringContaining("'deleted'"),
      expect.arrayContaining([TENANT_ID]),
    );
    expect(query).toHaveBeenCalledTimes(1); // logAdminAction
  });
});

// ===========================================================================
// 13–14: createImpersonationToken
// ===========================================================================

describe('createImpersonationToken', () => {
  it('13. vloží token s expires_at = NOW()+1h', async () => {
    const impRow = makeImpersonationRow();
    const auditRow = makeAuditRow({ action: 'create_impersonation_token' });
    const { db, query } = makeDb([[impRow], [auditRow]]);

    const result = await createImpersonationToken(ADMIN_ID, PROMOTER_ID, db);

    expect(result.adminId).toBe(ADMIN_ID);
    expect(result.targetPromoterId).toBe(PROMOTER_ID);
    expect(result.token).toBeTruthy();

    // Check expires_at param is ~1 hour from now
    const insertParams: unknown[] = query.mock.calls[0][1] as unknown[];
    const expiresAt = new Date(insertParams[3] as string);
    const nowPlus55min = new Date(Date.now() + 55 * 60 * 1000);
    const nowPlus65min = new Date(Date.now() + 65 * 60 * 1000);
    expect(expiresAt >= nowPlus55min).toBe(true);
    expect(expiresAt <= nowPlus65min).toBe(true);
  });

  it('14. token je dostatečně dlouhý (min 32 znaků)', async () => {
    const impRow = makeImpersonationRow();
    const auditRow = makeAuditRow();
    const { db, query } = makeDb([[impRow], [auditRow]]);

    await createImpersonationToken(ADMIN_ID, PROMOTER_ID, db);

    const insertParams: unknown[] = query.mock.calls[0][1] as unknown[];
    const token = insertParams[0] as string;
    expect(token.length).toBeGreaterThanOrEqual(32);
  });
});

// ===========================================================================
// 15–17: verifyImpersonationToken
// ===========================================================================

describe('verifyImpersonationToken', () => {
  it('15. vrátí token pokud platný', async () => {
    const impRow = makeImpersonationRow();
    const { db } = makeDb([[impRow]]);

    const result = await verifyImpersonationToken(impRow.token as string, db);

    expect(result.token).toBe(impRow.token);
    expect(result.adminId).toBe(ADMIN_ID);
  });

  it('16. hodí error pro expirovaný token', async () => {
    const expiredRow = makeImpersonationRow({
      expires_at: new Date(Date.now() - 1000).toISOString(),
      revoked_at: null,
    });
    const { db } = makeDb([[expiredRow]]);

    await expect(
      verifyImpersonationToken(expiredRow.token as string, db),
    ).rejects.toThrow('expired');
  });

  it('17. hodí error pro revokovaný token', async () => {
    const revokedRow = makeImpersonationRow({
      revoked_at: '2026-04-18T09:00:00Z',
    });
    const { db } = makeDb([[revokedRow]]);

    await expect(
      verifyImpersonationToken(revokedRow.token as string, db),
    ).rejects.toThrow('revoked');
  });
});

// ===========================================================================
// 18: revokeImpersonationToken
// ===========================================================================

describe('revokeImpersonationToken', () => {
  it('18. UPDATE revoked_at', async () => {
    const { db, execute } = makeDb([]);

    await revokeImpersonationToken('some-token', db);

    expect(execute).toHaveBeenCalledWith(
      expect.stringContaining('revoked_at'),
      expect.arrayContaining(['some-token']),
    );
  });
});

// ===========================================================================
// 19: listActiveImpersonations
// ===========================================================================

describe('listActiveImpersonations', () => {
  it('19. vrátí pouze nerevokované a neexpirované', async () => {
    const rows = [
      makeImpersonationRow({ token: 'tok1' }),
      makeImpersonationRow({ token: 'tok2' }),
    ];
    const { db, query } = makeDb([rows]);

    const result = await listActiveImpersonations(db);

    expect(result).toHaveLength(2);
    expect(result[0].token).toBe('tok1');

    const sql: string = query.mock.calls[0][0];
    expect(sql).toContain('revoked_at IS NULL');
    expect(sql).toContain('expires_at > NOW()');
  });
});

// ===========================================================================
// 20: logAdminAction
// ===========================================================================

describe('logAdminAction', () => {
  it('20. vloží záznam a vrátí s id', async () => {
    const returnedRow = makeAuditRow({ id: 'new-audit-id' });
    const { db, query } = makeDb([[returnedRow]]);

    const result = await logAdminAction(
      {
        adminId: ADMIN_ID,
        action: 'test_action',
        targetType: 'tenant',
        targetId: TENANT_ID,
        details: { key: 'value' },
      },
      db,
    );

    expect(result.id).toBe('new-audit-id');
    expect(result.adminId).toBe(ADMIN_ID);
    expect(query).toHaveBeenCalledWith(
      expect.stringContaining('INSERT INTO admin_audit_log'),
      expect.any(Array),
    );
  });
});

// ===========================================================================
// 21–23: getAuditLog
// ===========================================================================

describe('getAuditLog', () => {
  it('21. vrátí paginated výsledky', async () => {
    const rows = [makeAuditRow(), makeAuditRow({ id: 'audit-uuid-0002', total_count: '2' })];
    const { db } = makeDb([rows]);

    const result = await getAuditLog({}, db);

    expect(result.entries).toHaveLength(2);
    expect(result.total).toBe(1); // from first row total_count='1'
  });

  it('22. filtruje podle adminId', async () => {
    const { db, query } = makeDb([[makeAuditRow()]]);

    await getAuditLog({ adminId: ADMIN_ID }, db);

    const sql: string = query.mock.calls[0][0];
    expect(sql).toContain('admin_id = $');
    const params: unknown[] = query.mock.calls[0][1];
    expect(params).toContain(ADMIN_ID);
  });

  it('23. filtruje podle from/to datumu', async () => {
    const { db, query } = makeDb([[makeAuditRow()]]);

    await getAuditLog({ from: '2026-01-01', to: '2026-12-31' }, db);

    const sql: string = query.mock.calls[0][0];
    expect(sql).toContain('created_at >=');
    expect(sql).toContain('created_at <=');
    const params: unknown[] = query.mock.calls[0][1];
    expect(params).toContain('2026-01-01');
    expect(params).toContain('2026-12-31');
  });
});

// ===========================================================================
// 24–25: Platform overview & revenue stats
// ===========================================================================

describe('getPlatformOverview', () => {
  it('24. vrátí správnou strukturu', async () => {
    const statusRows = [
      { status: 'active', cnt: '15' },
      { status: 'suspended', cnt: '3' },
      { status: 'pending_verification', cnt: '2' },
    ];
    const orderRows = [
      { total_revenue: '9000000', total_orders: '120', total_tickets: '350' },
    ];
    const topTenants = [
      { tenant_id: 'tid1', name: 'Top Events', revenue: '3000000' },
    ];
    const dailyRows = [
      { date: '2026-04-17', revenue: '300000', orders: '4' },
    ];

    const { db } = makeDb([statusRows, orderRows, topTenants, dailyRows]);

    const overview = await getPlatformOverview(db);

    expect(overview.totalTenants).toBe(20);
    expect(overview.activeTenants).toBe(15);
    expect(overview.suspendedTenants).toBe(3);
    expect(overview.totalRevenue30d).toBe(9000000);
    expect(overview.totalOrders30d).toBe(120);
    expect(overview.totalTickets30d).toBe(350);
    expect(overview.topTenantsByRevenue).toHaveLength(1);
    expect(overview.topTenantsByRevenue[0].tenantId).toBe('tid1');
    expect(overview.revenueByDay).toHaveLength(1);
    expect(overview.revenueByDay[0].date).toBe('2026-04-17');
  });
});

describe('getRevenueStats', () => {
  it('25. vrátí pole s date+revenue+orders', async () => {
    const rows = [
      { date: '2026-04-17', revenue: '500000', orders: '8' },
      { date: '2026-04-16', revenue: '420000', orders: '7' },
      { date: '2026-04-15', revenue: '380000', orders: '6' },
    ];
    const { db, query } = makeDb([rows]);

    const result = await getRevenueStats(7, db);

    expect(result).toHaveLength(3);
    expect(result[0]).toEqual({ date: '2026-04-17', revenue: 500000, orders: 8 });
    expect(result[1]).toEqual({ date: '2026-04-16', revenue: 420000, orders: 7 });

    // Verify days param is passed
    const params: unknown[] = query.mock.calls[0][1];
    expect(params).toContain(7);
  });
});
