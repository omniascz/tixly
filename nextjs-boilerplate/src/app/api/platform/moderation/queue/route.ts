import { NextRequest, NextResponse } from 'next/server';
import { Pool } from 'pg';
import { requirePlatformAdmin } from '@/lib/platform-auth';

let pool: Pool | null = null;
function db(): Pool {
  if (!pool) pool = new Pool({ connectionString: process.env.DATABASE_URL });
  return pool;
}

interface QueueRow {
  id: string;
  title: string;
  description: string | null;
  date_start: string;
  status: string;
  created_at: string;
  promoter_name: string;
  promoter_slug: string;
  matched_keywords: string[] | null;
  reason: string | null;
}

export async function GET(req: NextRequest): Promise<Response> {
  const admin = await requirePlatformAdmin(req);
  if (!admin) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  const result = await db().query<QueueRow>(`
    SELECT
      e.id, e.title, e.description, e.date_start, e.status, e.created_at,
      p.name AS promoter_name, p.slug AS promoter_slug,
      latest.matched_keywords, latest.reason
    FROM catalog.events e
    JOIN platform.promoters p ON p.id = e.promoter_id
    LEFT JOIN LATERAL (
      SELECT matched_keywords, reason
      FROM audit.event_moderation_log
      WHERE event_id = e.id
      ORDER BY created_at DESC
      LIMIT 1
    ) latest ON TRUE
    WHERE e.status IN ('pending_review', 'flagged')
    ORDER BY e.created_at DESC
    LIMIT 100
  `);

  return NextResponse.json({ items: result.rows });
}
