/**
 * GET /api/admin/notifications — list pro přihlášeného promotéra
 * Filtry: ?unread=1, ?limit (max 100), ?offset, ?kind
 *
 * POST /api/admin/notifications/mark-all-read — mark all unread as read
 */

import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db/rls-pool';
import { runAsPromoter } from '@/lib/admin-auth';


interface Row {
  id: string;
  kind: string;
  severity: string;
  title: string;
  body: string | null;
  link: string | null;
  payload: unknown;
  read_at: string | null;
  created_at: string;
}

export async function GET(req: NextRequest): Promise<Response> {
  return runAsPromoter(req, async (promoter) => {
  const url = req.nextUrl;
  const unread = url.searchParams.get('unread') === '1';
  const kind = url.searchParams.get('kind');
  const limit = Math.min(100, Math.max(1, parseInt(url.searchParams.get('limit') ?? '50', 10)));
  const offset = Math.max(0, parseInt(url.searchParams.get('offset') ?? '0', 10));

  const wheres: string[] = ['promoter_id = $1'];
  const args: unknown[] = [promoter.promoterId];
  let p = 2;
  if (unread) wheres.push('read_at IS NULL');
  if (kind) {
    wheres.push(`kind = $${p++}`);
    args.push(kind);
  }
  args.push(limit, offset);

  const rows = await db().query<Row>(
    `SELECT id, kind, severity, title, body, link, payload, read_at, created_at
     FROM notifications.promoter_notifications
     WHERE ${wheres.join(' AND ')}
     ORDER BY created_at DESC
     LIMIT $${p++} OFFSET $${p++}`,
    args,
  );

  const unreadCount = await db().query<{ c: string }>(
    `SELECT COUNT(*)::text AS c FROM notifications.promoter_notifications
     WHERE promoter_id = $1 AND read_at IS NULL`,
    [promoter.promoterId],
  );

  return NextResponse.json({
    items: rows.rows.map((r) => ({
      id: r.id,
      kind: r.kind,
      severity: r.severity,
      title: r.title,
      body: r.body,
      link: r.link,
      payload: r.payload,
      readAt: r.read_at,
      createdAt: r.created_at,
    })),
    unreadCount: Number(unreadCount.rows[0]?.c ?? 0),
  });

  });
}

export async function POST(req: NextRequest): Promise<Response> {
  return runAsPromoter(req, async (promoter) => {
  const body = (await req.json().catch(() => ({}))) as { action?: string };
  if (body.action !== 'mark-all-read') {
    return NextResponse.json({ error: 'Unknown action' }, { status: 400 });
  }
  const r = await db().query<{ count: string }>(
    `WITH updated AS (
       UPDATE notifications.promoter_notifications
       SET read_at = NOW()
       WHERE promoter_id = $1 AND read_at IS NULL
       RETURNING id
     )
     SELECT COUNT(*)::text AS count FROM updated`,
    [promoter.promoterId],
  );
  return NextResponse.json({ marked: Number(r.rows[0]?.count ?? 0) });

  });
}
