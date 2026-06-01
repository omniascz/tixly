/**
 * GET /api/admin/widgets/catalog
 *
 * Vrátí seznam dostupných widgets pro customizable dashboard.
 */
import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db/rls-pool';
import { runAsPromoter } from '@/lib/admin-auth';


export async function GET(req: NextRequest): Promise<Response> {
  return runAsPromoter(req, async (_promoter) => {
  const r = await db().query(
    `SELECT id, title, description, category,
            default_width, default_height, min_width, min_height,
            data_endpoint, refresh_seconds
       FROM platform.dashboard_widgets
      WHERE is_active = true
   ORDER BY category, title`,
  );

  return NextResponse.json({ widgets: r.rows });

  });
}
