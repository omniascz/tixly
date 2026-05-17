/**
 * GET /api/platform/audit-log
 *
 * Master admin endpoint — DSA legal trail moderation rozhodnutí.
 * Filtry: ?eventId, ?actorType, ?decision, ?from, ?to,
 *         ?limit (max 200), ?offset, ?format=csv.
 *
 * format=csv vrací text/csv stream místo JSON (max export 5000 řádků).
 *
 * Auth: middleware vyžaduje platform admin (verify v requirePlatformAdmin).
 */

import { NextRequest, NextResponse } from 'next/server';
import { Pool } from 'pg';
import { requirePlatformAdmin } from '@/lib/platform-auth';

let pool: Pool | null = null;
function db(): Pool {
  if (!pool) pool = new Pool({ connectionString: process.env.DATABASE_URL });
  return pool;
}

interface LogRow {
  id: string;
  event_id: string;
  event_title: string | null;
  actor_user_id: string | null;
  actor_email: string | null;
  actor_type: string;
  decision: string;
  reason: string | null;
  matched_keywords: string[] | null;
  ai_score: string | null;
  ai_categories: string[] | null;
  created_at: string;
}

export async function GET(req: NextRequest): Promise<Response> {
  const admin = await requirePlatformAdmin(req);
  if (!admin) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  const url = new URL(req.url);
  const eventId = url.searchParams.get('eventId');
  const actorType = url.searchParams.get('actorType');
  const decision = url.searchParams.get('decision');
  const from = url.searchParams.get('from');
  const to = url.searchParams.get('to');
  const format = url.searchParams.get('format');
  const isCsv = format === 'csv';
  const limit = isCsv
    ? 5000
    : Math.min(200, parseInt(url.searchParams.get('limit') ?? '100', 10));
  const offset = Math.max(0, parseInt(url.searchParams.get('offset') ?? '0', 10));

  const wheres: string[] = [];
  const params: unknown[] = [];
  let i = 1;
  if (eventId && /^[0-9a-f-]{36}$/i.test(eventId)) {
    wheres.push(`l.event_id = $${i++}`);
    params.push(eventId);
  }
  if (
    actorType &&
    ['auto_keyword', 'auto_ai', 'human'].includes(actorType)
  ) {
    wheres.push(`l.actor_type = $${i++}`);
    params.push(actorType);
  }
  if (
    decision &&
    ['submitted', 'approved', 'rejected', 'flagged'].includes(decision)
  ) {
    wheres.push(`l.decision = $${i++}`);
    params.push(decision);
  }
  if (from) {
    wheres.push(`l.created_at >= $${i++}`);
    params.push(from);
  }
  if (to) {
    wheres.push(`l.created_at <= $${i++}`);
    params.push(to);
  }
  const whereClause = wheres.length > 0 ? 'WHERE ' + wheres.join(' AND ') : '';

  params.push(limit, offset);

  const r = await db().query<LogRow>(
    `SELECT
       l.id, l.event_id,
       e.title AS event_title,
       l.actor_user_id,
       u.email AS actor_email,
       l.actor_type, l.decision, l.reason,
       l.matched_keywords, l.ai_score, l.ai_categories,
       l.created_at
     FROM audit.event_moderation_log l
     LEFT JOIN catalog.events e ON e.id = l.event_id
     LEFT JOIN identity.users u ON u.id = l.actor_user_id
     ${whereClause}
     ORDER BY l.created_at DESC
     LIMIT $${i++} OFFSET $${i++}`,
    params,
  );

  if (isCsv) {
    const header = [
      'created_at',
      'event_id',
      'event_title',
      'actor_email',
      'actor_type',
      'decision',
      'reason',
      'ai_score',
    ];
    const lines = [header.join(',')];
    for (const row of r.rows) {
      lines.push(
        [
          row.created_at,
          row.event_id,
          row.event_title ?? '',
          row.actor_email ?? '',
          row.actor_type,
          row.decision,
          row.reason ?? '',
          row.ai_score ?? '',
        ]
          .map((v) => `"${String(v).replace(/"/g, '""')}"`)
          .join(','),
      );
    }
    return new Response(lines.join('\n'), {
      headers: {
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': `attachment; filename="moderation-log-${new Date().toISOString().slice(0, 10)}.csv"`,
      },
    });
  }

  const totalRes = await db().query<{ total: string }>(
    `SELECT COUNT(*)::text AS total FROM audit.event_moderation_log l ${whereClause}`,
    params.slice(0, params.length - 2),
  );
  const total = Number(totalRes.rows[0]?.total ?? 0);

  return NextResponse.json({
    items: r.rows.map((row) => ({
      id: row.id,
      eventId: row.event_id,
      eventTitle: row.event_title,
      actorUserId: row.actor_user_id,
      actorEmail: row.actor_email,
      actorType: row.actor_type,
      decision: row.decision,
      reason: row.reason,
      matchedKeywords: row.matched_keywords,
      aiScore: row.ai_score ? Number(row.ai_score) : null,
      aiCategories: row.ai_categories,
      createdAt: row.created_at,
    })),
    total,
    limit,
    offset,
  });
}
