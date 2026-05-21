/**
 * GET /api/admin/widgets/catalog
 *
 * Vrátí seznam dostupných widgets pro customizable dashboard.
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

  const r = await db().query(
    `SELECT id, title, description, category,
            default_width, default_height, min_width, min_height,
            data_endpoint, refresh_seconds
       FROM platform.dashboard_widgets
      WHERE is_active = true
   ORDER BY category, title`,
  );

  return NextResponse.json({ widgets: r.rows });
}
