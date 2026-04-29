/**
 * GET /api/platform/venues/[id]/seating-chart/versions — list all versions chronologically.
 *
 * Required schema (run once):
 *   ALTER TABLE catalog.venue_seating_charts
 *     ADD COLUMN IF NOT EXISTS created_by_user_id UUID REFERENCES identity.users(id),
 *     ADD COLUMN IF NOT EXISTS notes TEXT,
 *     ADD COLUMN IF NOT EXISTS source TEXT;  -- 'editor' | 'grid' | 'json' | 'csv' | 'svg' | 'restore'
 */

import { NextRequest, NextResponse } from 'next/server';
import { Pool } from 'pg';
import { requirePlatformAdmin } from '@/lib/platform-auth';

let pool: Pool | null = null;
function db(): Pool {
  if (!pool) pool = new Pool({ connectionString: process.env.DATABASE_URL });
  return pool;
}

interface VersionRow {
  id: string;
  name: string;
  total_seats: number;
  active: boolean;
  created_at: string;
  created_by_user_id: string | null;
  created_by_email: string | null;
  notes: string | null;
  source: string | null;
}

export async function GET(
  req: NextRequest,
  { params }: { params: { id: string } },
): Promise<Response> {
  const admin = await requirePlatformAdmin(req);
  if (!admin) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  const r = await db().query<VersionRow>(
    `SELECT c.id, c.name, c.total_seats, c.active, c.created_at,
            c.created_by_user_id, u.email AS created_by_email,
            c.notes, c.source
       FROM catalog.venue_seating_charts c
       LEFT JOIN identity.users u ON u.id = c.created_by_user_id
      WHERE c.venue_id = $1
      ORDER BY c.created_at DESC
      LIMIT 200`,
    [params.id],
  );

  // Compute version numbers (oldest = v1)
  const total = r.rows.length;
  const versions = r.rows.map((row, idx) => ({
    ...row,
    version: total - idx,
  }));

  return NextResponse.json({ versions });
}
