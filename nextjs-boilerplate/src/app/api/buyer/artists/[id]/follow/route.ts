/**
 * POST   /api/buyer/artists/{id}/follow   — follow artist
 * DELETE /api/buyer/artists/{id}/follow   — unfollow
 *
 * Auth: buyer (x-user-id required)
 */
import { NextRequest, NextResponse } from 'next/server';
import { runAsUser } from '@/lib/auth';
import { db } from '@/lib/db/rls-pool';

export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest, props: { params: Promise<{ id: string }> }): Promise<Response> {
  const params = await props.params;
  const artistId = params.id;

  return runAsUser(req, async (userId) => {
    // Verify artist exists
    const check = await db().query(
      `SELECT id FROM lineups.artists WHERE id = $1 LIMIT 1`,
      [artistId],
    );
    if (check.rows.length === 0) {
      return NextResponse.json({ error: 'ARTIST_NOT_FOUND' }, { status: 404 });
    }

    await db().query(
      `INSERT INTO lineups.artist_follows (user_id, artist_id)
       VALUES ($1, $2)
       ON CONFLICT DO NOTHING`,
      [userId, artistId],
    );

    return NextResponse.json({ ok: true, following: true });
  });
}

export async function DELETE(req: NextRequest, props: { params: Promise<{ id: string }> }): Promise<Response> {
  const params = await props.params;
  const artistId = params.id;

  return runAsUser(req, async (userId) => {
    await db().query(
      `DELETE FROM lineups.artist_follows WHERE user_id = $1 AND artist_id = $2`,
      [userId, artistId],
    );
    return NextResponse.json({ ok: true, following: false });
  });
}
