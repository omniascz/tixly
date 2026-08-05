/**
 * GET /api/platform/artists — list artists (across all promoters, platform admin view)
 */
import { NextRequest, NextResponse } from 'next/server';
import { db, runWithPlatformAdminContext } from '@/lib/db/rls-pool';
import { requirePlatformAdmin } from '@/lib/platform-auth';

export async function GET(req: NextRequest): Promise<Response> {
  const admin = await requirePlatformAdmin(req);
  if (!admin) return NextResponse.json({ error: 'FORBIDDEN' }, { status: 403 });

  // Platformni data — bez app.is_platform_admin RLS odfiltruje vse.
  // POZOR: pod admin kontextem RLS uz nefiltruje podle tenanta, filtruje dotaz.
  return runWithPlatformAdminContext(async () => {
    const client = await db().connect();
    try {
      await client.query('BEGIN');
      await client.query(`SET LOCAL app.is_platform_admin = 'true'`);
      const r = await client.query(
        `SELECT a.id, a.name, a.slug, a.bio, a.cover_image_url, a.genres, a.country,
                a.website_url, a.social_links, a.spotify_id, a.promoter_id,
                p.name AS promoter_name,
                (SELECT COUNT(*) FROM lineups.event_artists WHERE artist_id = a.id) AS event_count
           FROM lineups.artists a
           LEFT JOIN platform.promoters p ON p.id = a.promoter_id
           ORDER BY a.name
           LIMIT 500`,
      );
      await client.query('COMMIT');
      return NextResponse.json({ artists: r.rows });
    } catch (err) {
      await client.query('ROLLBACK').catch(() => undefined);
      console.error('[GET /api/platform/artists]', err);
      return NextResponse.json({ error: 'INTERNAL' }, { status: 500 });
    } finally {
      client.release();
    }
  });
}
