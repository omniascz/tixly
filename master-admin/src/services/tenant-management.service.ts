import type { DbAdapter, Tenant, TenantFilter } from '../lib/types.js';
import { logAdminAction } from './platform-audit.service.js';

// ---------------------------------------------------------------------------
// Row types
// ---------------------------------------------------------------------------

interface TenantRow {
  id: string;
  name: string;
  email: string;
  status: string;
  platform_fee_percent: string | number;
  created_at: string;
  total_revenue?: string | null;
  total_orders?: string | null;
  total_count?: string | null;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function parseIntSafe(val: string | number | null | undefined, fallback = 0): number {
  if (val === null || val === undefined) return fallback;
  const n = typeof val === 'number' ? val : parseInt(val, 10);
  return isNaN(n) ? fallback : n;
}

function parseFloatSafe(val: string | number | null | undefined, fallback = 0): number {
  if (val === null || val === undefined) return fallback;
  const n = typeof val === 'number' ? val : parseFloat(val);
  return isNaN(n) ? fallback : n;
}

function mapTenantRow(row: TenantRow): Tenant {
  return {
    id: row.id,
    name: row.name,
    email: row.email,
    status: row.status as Tenant['status'],
    platformFeePercent: parseFloatSafe(row.platform_fee_percent),
    createdAt: row.created_at,
    totalRevenue: row.total_revenue !== undefined ? parseIntSafe(row.total_revenue) : undefined,
    totalOrders: row.total_orders !== undefined ? parseIntSafe(row.total_orders) : undefined,
  };
}

// ---------------------------------------------------------------------------
// Service
// ---------------------------------------------------------------------------

/**
 * Výpis tenantů s filtrováním a paginací.
 */
export async function listTenants(
  filter: TenantFilter,
  db: DbAdapter,
): Promise<{ tenants: Tenant[]; total: number }> {
  const { status, search, page = 1, pageSize = 20 } = filter;
  const offset = (page - 1) * pageSize;

  const params: unknown[] = [];
  const conditions: string[] = [];

  if (status) {
    params.push(status);
    conditions.push(`p.status = $${params.length}`);
  }
  if (search) {
    params.push(`%${search}%`);
    const idx = params.length;
    conditions.push(`(p.name ILIKE $${idx} OR p.email ILIKE $${idx})`);
  }

  const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

  params.push(pageSize);
  const limitIdx = params.length;
  params.push(offset);
  const offsetIdx = params.length;

  const rows = await db.query<TenantRow>(
    `SELECT
       p.id,
       p.name,
       p.email,
       p.status,
       p.platform_fee_percent,
       p.created_at::TEXT,
       COALESCE(SUM(o.total_amount), 0)::TEXT AS total_revenue,
       COUNT(o.id)::TEXT AS total_orders,
       COUNT(*) OVER()::TEXT AS total_count
     FROM platform.promoters p
     LEFT JOIN orders.orders o ON o.promoter_id = p.id AND o.status = 'paid'
     ${where}
     GROUP BY p.id, p.name, p.email, p.status, p.platform_fee_percent, p.created_at
     ORDER BY p.created_at DESC
     LIMIT $${limitIdx} OFFSET $${offsetIdx}`,
    params,
  );

  const total = rows.length > 0 ? parseIntSafe(rows[0].total_count) : 0;
  return { tenants: rows.map(mapTenantRow), total };
}

/**
 * Detail jednoho tenanta se statistikami.
 */
export async function getTenant(tenantId: string, db: DbAdapter): Promise<Tenant> {
  const rows = await db.query<TenantRow>(
    `SELECT
       p.id,
       p.name,
       p.email,
       p.status,
       p.platform_fee_percent,
       p.created_at::TEXT,
       COALESCE(SUM(o.total_amount), 0)::TEXT AS total_revenue,
       COUNT(o.id)::TEXT AS total_orders
     FROM platform.promoters p
     LEFT JOIN orders.orders o ON o.promoter_id = p.id AND o.status = 'paid'
     WHERE p.id = $1
     GROUP BY p.id, p.name, p.email, p.status, p.platform_fee_percent, p.created_at`,
    [tenantId],
  );

  if (rows.length === 0) {
    throw new Error(`Tenant ${tenantId} not found`);
  }

  return mapTenantRow(rows[0]);
}

/**
 * Pozastavení účtu promotéra (s důvodem).
 */
export async function suspendTenant(
  tenantId: string,
  reason: string,
  adminId: string,
  db: DbAdapter,
): Promise<void> {
  // Check current status
  const rows = await db.query<{ status: string }>(
    `SELECT status FROM platform.promoters WHERE id = $1`,
    [tenantId],
  );

  if (rows.length === 0) {
    throw new Error(`Tenant ${tenantId} not found`);
  }

  if (rows[0].status === 'suspended') {
    throw new Error(`Tenant ${tenantId} is already suspended`);
  }

  await db.execute(
    `UPDATE platform.promoters SET status = 'suspended', updated_at = NOW() WHERE id = $1`,
    [tenantId],
  );

  await logAdminAction(
    {
      adminId,
      action: 'suspend_tenant',
      targetType: 'tenant',
      targetId: tenantId,
      details: { reason },
    },
    db,
  );
}

/**
 * Reaktivace pozastaveného účtu.
 */
export async function reactivateTenant(
  tenantId: string,
  adminId: string,
  db: DbAdapter,
): Promise<void> {
  await db.execute(
    `UPDATE platform.promoters SET status = 'active', updated_at = NOW() WHERE id = $1`,
    [tenantId],
  );

  await logAdminAction(
    {
      adminId,
      action: 'reactivate_tenant',
      targetType: 'tenant',
      targetId: tenantId,
    },
    db,
  );
}

/**
 * Změna platform fee pro konkrétního tenanta.
 */
export async function updateTenantFee(
  tenantId: string,
  feePercent: number,
  adminId: string,
  db: DbAdapter,
): Promise<void> {
  if (feePercent < 0) {
    throw new Error('Platform fee percent cannot be negative');
  }
  if (feePercent > 100) {
    throw new Error('Platform fee percent cannot exceed 100');
  }

  await db.execute(
    `UPDATE platform.promoters
     SET platform_fee_percent = $1, updated_at = NOW()
     WHERE id = $2`,
    [feePercent, tenantId],
  );

  await logAdminAction(
    {
      adminId,
      action: 'update_tenant_fee',
      targetType: 'platform_fee',
      targetId: tenantId,
      details: { feePercent },
    },
    db,
  );
}

/**
 * Smazání tenanta (soft delete — status = 'deleted', data zůstávají).
 */
export async function deleteTenant(
  tenantId: string,
  adminId: string,
  db: DbAdapter,
): Promise<void> {
  await db.execute(
    `UPDATE platform.promoters SET status = 'deleted', updated_at = NOW() WHERE id = $1`,
    [tenantId],
  );

  await logAdminAction(
    {
      adminId,
      action: 'delete_tenant',
      targetType: 'tenant',
      targetId: tenantId,
    },
    db,
  );
}
