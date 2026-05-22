/**
 * POST /api/admin/facebook/pages/[pageId]/disconnect
 *
 * Soft delete: nastaví disconnected_at + zachová audit. Re-OAuth ho znovu
 * naplní (ON CONFLICT).
 */

import { NextRequest, NextResponse } from 'next/server';
import { Pool } from 'pg';
import { requirePromoter } from '@/lib/admin-auth';

let pool: Pool | null = null;
function db(): Pool {
  if (!pool) pool = new Pool({ connectionString: process.env.DATABASE_URL });
  return pool;
}

export async function POST(
  req: NextRequest,
  { params }: { params: { pageId: string } },
): Promise<Response> {
  const promoter = await requirePromoter(req);
  if (!promoter || promoter.status !== 'active') {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  if (!/^[0-9a-f-]{36}$/i.test(params.pageId)) {
    return NextResponse.json({ error: 'Invalid id' }, { status: 422 });
  }

  const r = await db().query<{ id: string }>(
    `UPDATE marketing.facebook_pages
       SET disconnected_at = now()
     WHERE id = $1 AND promoter_id = $2 AND disconnected_at IS NULL
     RETURNING id`,
    [params.pageId, promoter.promoterId],
  );
  if (r.rows.length === 0) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }
  return NextResponse.json({ ok: true });
}
