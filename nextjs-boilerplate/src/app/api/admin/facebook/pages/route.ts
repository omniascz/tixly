/**
 * GET /api/admin/facebook/pages — list napojených FB pages pro promotéra.
 */

import { NextRequest, NextResponse } from 'next/server';
import { Pool } from 'pg';
import { requirePromoter } from '@/lib/admin-auth';
import { isMockMode } from '@/lib/facebook/graph';

let pool: Pool | null = null;
function db(): Pool {
  if (!pool) pool = new Pool({ connectionString: process.env.DATABASE_URL });
  return pool;
}

export async function GET(req: NextRequest): Promise<Response> {
  const promoter = await requirePromoter(req);
  if (!promoter || promoter.status !== 'active') {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const r = await db().query<{
    id: string;
    fb_page_id: string;
    page_name: string;
    page_category: string | null;
    page_picture_url: string | null;
    connected_at: string;
    is_mock: boolean;
  }>(
    `SELECT id, fb_page_id, page_name, page_category, page_picture_url,
            connected_at, is_mock
     FROM marketing.facebook_pages
     WHERE promoter_id = $1 AND disconnected_at IS NULL
     ORDER BY connected_at DESC`,
    [promoter.promoterId],
  );

  return NextResponse.json({
    mockMode: isMockMode(),
    pages: r.rows.map((p) => ({
      id: p.id,
      fbPageId: p.fb_page_id,
      name: p.page_name,
      category: p.page_category,
      pictureUrl: p.page_picture_url,
      connectedAt: p.connected_at,
      isMock: p.is_mock,
    })),
  });
}
