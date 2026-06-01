/**
 * GET /api/admin/scanner/export
 *
 * TM Parity Fáze 3 — Scan Log Export (multi-event, extra fields).
 *
 * Query params:
 *   - eventId      (string, optional)   — pokud chybí, vrátí napříč všemi events promotéra
 *   - eventIds     (string, optional)   — comma-separated, vícero events najednou
 *   - groupId      (string, optional)   — všechna events v event_group
 *   - dateFrom     (ISO, optional)
 *   - dateTo       (ISO, optional)
 *   - format       ('csv' | 'json')
 *
 * Vrací data dle skutečného schématu tickets.scan_logs: scanned_at, ticket_id,
 * event, scan_result, device (scanned_by_device_id), override_by/reason,
 * promoter_name, ticket_type.
 */
import { NextRequest, NextResponse } from 'next/server';
import { Pool } from 'pg';
import { requirePromoter } from '@/lib/admin-auth';

let pool: Pool | null = null;
function db(): Pool {
  if (!pool) pool = new Pool({ connectionString: process.env.DATABASE_URL });
  return pool;
}

export async function GET(req: NextRequest): Promise<Response> {
  const promoter = await requirePromoter(req);
  if (!promoter) return NextResponse.json({ error: 'UNAUTHORIZED' }, { status: 401 });

  const url = new URL(req.url);
  const eventId = url.searchParams.get('eventId');
  const eventIdsRaw = url.searchParams.get('eventIds');
  const groupId = url.searchParams.get('groupId');
  const dateFrom = url.searchParams.get('dateFrom');
  const dateTo = url.searchParams.get('dateTo');
  const format = (url.searchParams.get('format') ?? 'csv').toLowerCase();

  const conditions: string[] = [`e.promoter_id = $1`];
  const args: unknown[] = [promoter.promoterId];

  if (eventId) {
    args.push(eventId);
    conditions.push(`s.event_id = $${args.length}`);
  } else if (eventIdsRaw) {
    const ids = eventIdsRaw.split(',').map((s) => s.trim()).filter(Boolean);
    if (ids.length > 0) {
      args.push(ids);
      conditions.push(`s.event_id = ANY($${args.length}::uuid[])`);
    }
  } else if (groupId) {
    args.push(groupId);
    conditions.push(`s.event_id IN (SELECT event_id FROM event_groups.members WHERE group_id = $${args.length})`);
  }

  if (dateFrom) {
    args.push(dateFrom);
    conditions.push(`s.scanned_at >= $${args.length}::timestamptz`);
  }
  if (dateTo) {
    args.push(dateTo);
    conditions.push(`s.scanned_at <= $${args.length}::timestamptz`);
  }

  const sql = `
    SELECT
      s.id,
      s.scanned_at::text AS scanned_at,
      s.ticket_id,
      s.ticket_id::text AS ticket_code,
      e.id AS event_id,
      e.title AS event_title,
      e.date_start::text AS event_starts_at,
      s.scan_result,
      s.scanned_by_device_id AS device_id,
      s.override_by,
      s.override_reason,
      u.name AS override_by_name,
      tt.name AS ticket_type,
      p.name AS promoter_name
    FROM tickets.scan_logs s
    JOIN catalog.events e ON e.id = s.event_id
    LEFT JOIN tickets.tickets t ON t.id = s.ticket_id
    LEFT JOIN catalog.ticket_types tt ON tt.id = t.ticket_type_id
    LEFT JOIN identity.users u ON u.id = s.override_by
    LEFT JOIN platform.promoters p ON p.id = e.promoter_id
    WHERE ${conditions.join(' AND ')}
    ORDER BY s.scanned_at DESC
    LIMIT 50000
  `;

  let rows: Record<string, unknown>[];
  try {
    const r = await db().query<Record<string, unknown>>(sql, args);
    rows = r.rows;
  } catch (e) {
    return NextResponse.json(
      { error: 'DB_ERROR', message: e instanceof Error ? e.message : 'unknown' },
      { status: 500 },
    );
  }

  if (format === 'json') {
    return NextResponse.json({ rows, count: rows.length });
  }

  // CSV — RFC 4180
  const headers = [
    'scanned_at', 'event_title', 'event_starts_at', 'ticket_code', 'ticket_type',
    'scan_result', 'device_id', 'override_by_name', 'override_reason', 'promoter_name',
  ];
  function csvEscape(v: unknown): string {
    if (v === null || v === undefined) return '';
    const s = String(v);
    if (s.includes(',') || s.includes('"') || s.includes('\n')) {
      return `"${s.replace(/"/g, '""')}"`;
    }
    return s;
  }
  const lines = [headers.join(',')];
  for (const row of rows) {
    lines.push(headers.map((h) => csvEscape(row[h])).join(','));
  }
  const csv = lines.join('\r\n');

  const filename = `scan-log-${new Date().toISOString().slice(0, 10)}.csv`;
  return new Response(csv, {
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="${filename}"`,
    },
  });
}
