import type { DbAdapter, AdminAuditEntry } from '../lib/types.js';

// ---------------------------------------------------------------------------
// Row types
// ---------------------------------------------------------------------------

interface AuditRow {
  id: string;
  admin_id: string;
  action: string;
  target_type: string;
  target_id: string | null;
  details: Record<string, unknown> | string | null;
  ip_address: string | null;
  created_at: string;
  total_count?: string | null;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function parseIntSafe(val: string | null | undefined, fallback = 0): number {
  if (val === null || val === undefined) return fallback;
  const n = parseInt(val, 10);
  return isNaN(n) ? fallback : n;
}

function mapAuditRow(row: AuditRow): AdminAuditEntry {
  return {
    id: row.id,
    adminId: row.admin_id,
    action: row.action,
    targetType: row.target_type as AdminAuditEntry['targetType'],
    targetId: row.target_id ?? undefined,
    details:
      row.details === null
        ? undefined
        : typeof row.details === 'string'
          ? JSON.parse(row.details)
          : row.details,
    ipAddress: row.ip_address ?? undefined,
    createdAt: row.created_at,
  };
}

// ---------------------------------------------------------------------------
// Service
// ---------------------------------------------------------------------------

/**
 * Zapíše admin akci do audit logu.
 */
export async function logAdminAction(
  entry: Omit<AdminAuditEntry, 'id' | 'createdAt'>,
  db: DbAdapter,
): Promise<AdminAuditEntry> {
  const rows = await db.query<AuditRow>(
    `INSERT INTO admin_audit_log
       (admin_id, action, target_type, target_id, details, ip_address)
     VALUES ($1, $2, $3, $4, $5::jsonb, $6)
     RETURNING id, admin_id, action, target_type, target_id,
               details, ip_address, created_at::TEXT`,
    [
      entry.adminId,
      entry.action,
      entry.targetType,
      entry.targetId ?? null,
      entry.details ? JSON.stringify(entry.details) : null,
      entry.ipAddress ?? null,
    ],
  );

  const row = rows[0];
  if (!row) {
    throw new Error('Failed to insert audit log entry');
  }
  return mapAuditRow(row);
}

/**
 * Výpis audit logu s filtrováním a paginací.
 */
export async function getAuditLog(
  filter: {
    adminId?: string;
    targetType?: string;
    from?: string;
    to?: string;
    page?: number;
  },
  db: DbAdapter,
): Promise<{ entries: AdminAuditEntry[]; total: number }> {
  const { adminId, targetType, from, to, page = 1 } = filter;
  const pageSize = 20;
  const offset = (page - 1) * pageSize;

  const params: unknown[] = [];
  const conditions: string[] = [];

  if (adminId) {
    params.push(adminId);
    conditions.push(`admin_id = $${params.length}`);
  }
  if (targetType) {
    params.push(targetType);
    conditions.push(`target_type = $${params.length}`);
  }
  if (from) {
    params.push(from);
    conditions.push(`created_at >= $${params.length}`);
  }
  if (to) {
    params.push(to);
    conditions.push(`created_at <= $${params.length}`);
  }

  const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

  params.push(pageSize);
  const limitIdx = params.length;
  params.push(offset);
  const offsetIdx = params.length;

  const rows = await db.query<AuditRow>(
    `SELECT
       id, admin_id, action, target_type, target_id,
       details, ip_address, created_at::TEXT,
       COUNT(*) OVER()::TEXT AS total_count
     FROM admin_audit_log
     ${where}
     ORDER BY created_at DESC
     LIMIT $${limitIdx} OFFSET $${offsetIdx}`,
    params,
  );

  const total = rows.length > 0 ? parseIntSafe(rows[0].total_count) : 0;
  return { entries: rows.map(mapAuditRow), total };
}
