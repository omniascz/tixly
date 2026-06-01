/**
 * GET /api/admin/audit-log — promotérův audit (kdo z týmu co udělal)
 *
 * Filtruje `audit.audit_log` na actor_id ∈ promoter_members tohoto promotéra.
 * Filtry: ?action, ?table, ?from, ?to, ?actorId, ?actorType,
 *         ?limit (max 200), ?offset, ?format=csv
 *
 * format=csv vrací text/csv stream místo JSON (limit ignorován,
 * max export 5000 řádků).
 */

import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db/rls-pool';
import { runAsPromoter } from '@/lib/admin-auth';


interface LogRow {
  id: string;
  schema_name: string;
  table_name: string;
  record_id: string;
  action: 'INSERT' | 'UPDATE' | 'DELETE';
  actor_id: string | null;
  actor_email: string | null;
  actor_name: string | null;
  actor_type: string;
  old_values: unknown;
  new_values: unknown;
  ip_address: string | null;
  created_at: string;
}

export async function GET(req: NextRequest): Promise<Response> {
  return runAsPromoter(req, async (promoter) => {
  const url = req.nextUrl;
  const action = url.searchParams.get('action');
  const table = url.searchParams.get('table');
  const from = url.searchParams.get('from');
  const to = url.searchParams.get('to');
  const actorId = url.searchParams.get('actorId');
  const actorType = url.searchParams.get('actorType');
  const format = url.searchParams.get('format');
  const isCsv = format === 'csv';
  const limit = isCsv
    ? 5000
    : Math.min(200, Math.max(1, parseInt(url.searchParams.get('limit') ?? '100', 10)));
  const offset = Math.max(0, parseInt(url.searchParams.get('offset') ?? '0', 10));

  const wheres: string[] = [
    // Jen akce uživatelů, kteří patří tomuto promotérovi
    `al.actor_id IN (SELECT user_id FROM platform.promoter_members WHERE promoter_id = $1)`,
  ];
  const args: unknown[] = [promoter.promoterId];
  let p = 2;

  if (action) {
    args.push(action);
    wheres.push(`al.action = $${p++}`);
  }
  if (table) {
    args.push(table);
    wheres.push(`al.table_name = $${p++}`);
  }
  if (from) {
    args.push(from);
    wheres.push(`al.created_at >= $${p++}::timestamptz`);
  }
  if (to) {
    args.push(to);
    wheres.push(`al.created_at <= $${p++}::timestamptz`);
  }
  if (actorId) {
    args.push(actorId);
    wheres.push(`al.actor_id = $${p++}`);
  }
  if (actorType && ['user', 'system', 'api', 'cron'].includes(actorType)) {
    args.push(actorType);
    wheres.push(`al.actor_type = $${p++}`);
  }

  args.push(limit, offset);
  const limitOffsetPart = `LIMIT $${p++} OFFSET $${p++}`;

  const r = await db().query<LogRow>(
    `SELECT al.id::text AS id, al.schema_name, al.table_name, al.record_id, al.action,
            al.actor_id, u.email AS actor_email, u.name AS actor_name,
            al.actor_type, al.old_values, al.new_values, al.ip_address::text, al.created_at
     FROM audit.audit_log al
     LEFT JOIN identity.users u ON u.id = al.actor_id
     WHERE ${wheres.join(' AND ')}
     ORDER BY al.created_at DESC
     ${limitOffsetPart}`,
    args,
  );

  if (isCsv) {
    const header = [
      'created_at',
      'action',
      'schema',
      'table',
      'record_id',
      'actor_email',
      'actor_name',
      'actor_type',
      'ip_address',
    ];
    const lines = [header.join(',')];
    for (const row of r.rows) {
      lines.push(
        [
          row.created_at,
          row.action,
          row.schema_name,
          row.table_name,
          row.record_id,
          row.actor_email ?? '',
          row.actor_name ?? '',
          row.actor_type,
          row.ip_address ?? '',
        ]
          .map((v) => `"${String(v).replace(/"/g, '""')}"`)
          .join(','),
      );
    }
    return new Response(lines.join('\n'), {
      headers: {
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': `attachment; filename="audit-log-${new Date().toISOString().slice(0, 10)}.csv"`,
      },
    });
  }

  // Distinct tables / actions pro filter dropdown
  const meta = await db().query<{ table_name: string; cnt: string }>(
    `SELECT al.table_name, COUNT(*)::text AS cnt
     FROM audit.audit_log al
     WHERE al.actor_id IN (SELECT user_id FROM platform.promoter_members WHERE promoter_id = $1)
       AND al.created_at > now() - interval '90 days'
     GROUP BY al.table_name
     ORDER BY cnt DESC
     LIMIT 30`,
    [promoter.promoterId],
  );

  return NextResponse.json({
    entries: r.rows.map((row) => ({
      id: row.id,
      schema: row.schema_name,
      table: row.table_name,
      recordId: row.record_id,
      action: row.action,
      actorId: row.actor_id,
      actorEmail: row.actor_email,
      actorName: row.actor_name,
      actorType: row.actor_type,
      oldValues: row.old_values,
      newValues: row.new_values,
      ipAddress: row.ip_address,
      createdAt: row.created_at,
    })),
    filters: {
      tables: meta.rows.map((m) => ({ name: m.table_name, count: Number(m.cnt) })),
    },
  });

  });
}
