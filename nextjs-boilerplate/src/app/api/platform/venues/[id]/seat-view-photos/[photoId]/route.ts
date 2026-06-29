/**
 * DELETE /api/platform/venues/[id]/seat-view-photos/[photoId]
 *
 * Platform admin only. Smaže foto pro daný sektor.
 */
import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db/rls-pool';
import { requirePlatformAdmin } from '@/lib/platform-auth';

export async function DELETE(
  req: NextRequest,
  { params }: { params: { id: string; photoId: string } },
): Promise<Response> {
  const admin = await requirePlatformAdmin(req);
  if (!admin) return NextResponse.json({ error: 'FORBIDDEN' }, { status: 403 });

  const client = await db().connect();
  try {
    await client.query('BEGIN');
    await client.query(`SET LOCAL app.is_platform_admin = 'true'`);

    const r = await client.query(
      `DELETE FROM catalog.seat_view_photos
        WHERE id = $1 AND venue_id = $2`,
      [params.photoId, params.id],
    );

    await client.query('COMMIT');

    if (r.rowCount === 0) {
      return NextResponse.json({ error: 'NOT_FOUND' }, { status: 404 });
    }
    return NextResponse.json({ deleted: params.photoId });
  } catch (err) {
    await client.query('ROLLBACK').catch(() => undefined);
    console.error('[DELETE /api/platform/venues/seat-view-photos/:id]', err);
    return NextResponse.json({ error: 'INTERNAL' }, { status: 500 });
  } finally {
    client.release();
  }
}
