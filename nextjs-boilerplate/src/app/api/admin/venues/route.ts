/**
 * GET /api/admin/venues — read-only dropdown pro tvorbu akce.
 *
 * Sály spravuje master admin (`/platform/venues` — TBD), ne promotér.
 * Tady jen vrátíme všechny aktivní sály jako seznam pro výběr v `/admin/events/new`.
 */

import { NextRequest, NextResponse } from 'next/server';
import { Pool } from 'pg';
import { requirePromoter } from '@/lib/admin-auth';

let pool: Pool | null = null;
function db(): Pool {
  if (!pool) pool = new Pool({ connectionString: process.env.DATABASE_URL });
  return pool;
}

interface VenueRow {
  id: string;
  name: string;
  city: string;
  capacity: number;
  venue_type: string;
}

export async function GET(req: NextRequest): Promise<Response> {
  const promoter = await requirePromoter(req);
  if (!promoter) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const r = await db().query<VenueRow>(
    `SELECT id, name, city, capacity, venue_type
     FROM catalog.venues
     WHERE archived_at IS NULL
     ORDER BY name
     LIMIT 500`,
  );
  return NextResponse.json({ venues: r.rows });
}
