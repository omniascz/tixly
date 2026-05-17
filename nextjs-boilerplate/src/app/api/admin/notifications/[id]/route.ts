/**
 * PATCH /api/admin/notifications/[id] — mark single as read (body: {readAt: true} nebo {readAt: false})
 * DELETE /api/admin/notifications/[id] — remove notification (jen vlastní)
 */

import { NextRequest, NextResponse } from 'next/server';
import { Pool } from 'pg';
import { requirePromoter } from '@/lib/admin-auth';

let pool: Pool | null = null;
function db(): Pool {
  if (!pool) pool = new Pool({ connectionString: process.env.DATABASE_URL });
  return pool;
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  const promoter = await requirePromoter(req);
  if (!promoter) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) {
    return NextResponse.json({ error: 'Bad id' }, { status: 400 });
  }
  const body = await req.json().catch(() => ({}));
  const readAtVal = body?.readAt === true ? 'NOW()' : body?.readAt === false ? 'NULL' : null;
  if (!readAtVal) {
    return NextResponse.json({ error: 'readAt boolean required' }, { status: 422 });
  }

  const r = await db().query(
    `UPDATE notifications.promoter_notifications
     SET read_at = ${readAtVal}
     WHERE id = $1 AND promoter_id = $2
     RETURNING id`,
    [id, promoter.promoterId],
  );
  if (r.rowCount === 0) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }
  return NextResponse.json({ ok: true });
}

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  const promoter = await requirePromoter(req);
  if (!promoter) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) {
    return NextResponse.json({ error: 'Bad id' }, { status: 400 });
  }
  const r = await db().query(
    `DELETE FROM notifications.promoter_notifications
     WHERE id = $1 AND promoter_id = $2 RETURNING id`,
    [id, promoter.promoterId],
  );
  if (r.rowCount === 0) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }
  return NextResponse.json({ ok: true });
}
