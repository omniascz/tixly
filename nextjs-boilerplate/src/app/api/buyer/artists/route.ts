/**
 * GET /api/buyer/artists?q=&genre=&limit=&cursor=
 *
 * Public artist discovery — browse and search artists across all promoters.
 * Returns followed status for authenticated users (x-user-id header set by middleware).
 */
import { NextRequest, NextResponse } from 'next/server';
import { db, runWithServiceContext } from '@/lib/db/rls-pool';

export const dynamic = 'force-dynamic';

interface ArtistRow {
  id:              string;
  name:            string;
  slug:            string;
  bio:             string | null;
  cover_image_url: string | null;
  genres:          string[] | null;
  country:         string | null;
  spotify_id:      string | null;
  event_count:     string;
  is_followed:     boolean;
}

export async function GET(req: NextRequest): Promise<Response> {
  const sp     = req.nextUrl.searchParams;
  const q      = sp.get('q')?.trim() ?? '';
  const genre  = sp.get('genre') ?? '';
  const limit  = Math.min(parseInt(sp.get('limit') ?? '24'), 100);
  const cursor = sp.get('cursor');
  const userId = req.headers.get('x-user-id');

  return runWithServiceContext(async () => {
    const params: (string | number)[] = [];
    const conditions: string[] = ['1=1'];

    if (q) {
      params.push(`%${q}%`);
      conditions.push(`(a.name ILIKE $${params.length} OR a.bio ILIKE $${params.length})`);
    }
    if (genre) {
      params.push(genre);
      conditions.push(`$${params.length} = ANY(a.genres)`);
    }
    if (cursor) {
      params.push(cursor);
      conditions.push(`a.id > $${params.length}`);
    }

    params.push(limit + 1);
    const limitParam = params.length;

    const rows = await db().query<ArtistRow>(
      `SELECT
         a.id, a.name, a.slug, a.bio, a.cover_image_url, a.genres, a.country, a.spotify_id,
         COUNT(DISTINCT ea.event_id)::text AS event_count,
         ${userId
           ? `EXISTS(SELECT 1 FROM lineups.artist_follows af WHERE af.artist_id = a.id AND af.user_id = '${userId}'::uuid) AS is_followed`
           : 'FALSE AS is_followed'
         }
       FROM lineups.artists a
       LEFT JOIN lineups.event_artists ea ON ea.artist_id = a.id
       LEFT JOIN catalog.events e ON e.id = ea.event_id AND e.status = 'published' AND e.date_start > NOW()
       WHERE ${conditions.join(' AND ')}
       GROUP BY a.id
       ORDER BY COUNT(DISTINCT ea.event_id) DESC, a.name ASC
       LIMIT $${limitParam}`,
    );

    const hasMore = rows.rows.length > limit;
    const items   = hasMore ? rows.rows.slice(0, limit) : rows.rows;
    const next    = hasMore ? items[items.length - 1]?.id : null;

    return NextResponse.json({
      artists: items.map((r) => ({
        id:            r.id,
        name:          r.name,
        slug:          r.slug,
        bio:           r.bio,
        coverImageUrl: r.cover_image_url,
        genres:        r.genres ?? [],
        country:       r.country,
        spotifyId:     r.spotify_id,
        upcomingEvents: Number(r.event_count),
        isFollowed:    r.is_followed,
      })),
      cursor: next,
      hasMore,
    });
  });
}
