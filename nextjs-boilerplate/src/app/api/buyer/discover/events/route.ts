/**
 * GET /api/buyer/discover/events — personalizovaná doporučení podle Spotify
 *
 * Score logic:
 *   • Artist name match (case-insensitive ILIKE) → +10 / rank (1=top)
 *   • Genre intersection (user.genres ∩ artist.genres) → +3 za každý
 *   • Future events only (date_start > NOW())
 *   • Distinct events, sort by total_score DESC, date_start ASC
 *
 * Pokud user nemá Spotify connection, vrátí prázdné `events: []` s
 * `hasConnection: false` flagem pro UI.
 *
 * DACH parity #P2-3 (DICE 40 %+ prodejů přes discovery).
 */
import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db/rls-pool';
import { runAsUser } from '@/lib/auth';


export async function GET(req: NextRequest): Promise<Response> {
  return runAsUser(req, async (userId) => {
  const limit = Math.min(
    Number(req.nextUrl.searchParams.get('limit') ?? '20'),
    50,
  );

  const client = await db().connect();
  try {
    await client.query('BEGIN');
    await client.query(`SET LOCAL app.is_platform_admin = 'true'`);

    // Connection check
    const conn = await client.query<{ is_mock: boolean }>(
      `SELECT is_mock FROM marketing.user_spotify_connections WHERE user_id = $1`,
      [userId],
    );
    if (conn.rows.length === 0) {
      await client.query('COMMIT');
      return NextResponse.json({
        hasConnection: false,
        events: [],
        message: 'Připoj Spotify pro personalizovaná doporučení.',
      });
    }

    // Score query: artist name match + genre intersection
    const rows = await client.query<{
      event_id: string;
      title: string;
      date_start: string;
      cover_image_url: string | null;
      score: number;
      matched_artists: string[];
      matched_genres: string[];
    }>(
      `WITH user_artists AS (
         SELECT artist_name, rank, genres FROM marketing.user_top_artists WHERE user_id = $1
       ),
       artist_scores AS (
         SELECT ea.event_id,
                a.name AS artist_matched,
                10.0 / NULLIF(ua.rank, 0) AS score
           FROM user_artists ua
           JOIN lineups.artists a
             ON LOWER(a.name) = LOWER(ua.artist_name)
           JOIN lineups.event_artists ea ON ea.artist_id = a.id
       ),
       genre_scores AS (
         SELECT ea.event_id,
                ua.genres AS user_genres,
                a.genres AS artist_genres,
                3.0 * cardinality(ARRAY(SELECT unnest(ua.genres) INTERSECT SELECT unnest(a.genres))) AS score
           FROM user_artists ua
           JOIN lineups.artists a ON cardinality(ARRAY(SELECT unnest(ua.genres) INTERSECT SELECT unnest(a.genres))) > 0
           JOIN lineups.event_artists ea ON ea.artist_id = a.id
       ),
       combined AS (
         SELECT event_id, SUM(score) AS s, ARRAY_AGG(DISTINCT artist_matched) FILTER (WHERE artist_matched IS NOT NULL) AS matched_artists
           FROM artist_scores GROUP BY event_id
         UNION ALL
         SELECT event_id, SUM(score), '{}'::text[] FROM genre_scores GROUP BY event_id
       ),
       agg AS (
         SELECT event_id, SUM(s) AS total_score,
                ARRAY_AGG(DISTINCT a) FILTER (WHERE a IS NOT NULL) AS matched_artists
           FROM combined c
           LEFT JOIN LATERAL unnest(c.matched_artists) AS a ON true
          GROUP BY event_id
       )
       SELECT e.id AS event_id, e.title, e.date_start::text,
              e.cover_image_url, agg.total_score AS score,
              agg.matched_artists,
              ARRAY(
                SELECT DISTINCT genre FROM (
                  SELECT unnest(ua.genres) AS genre FROM user_artists ua
                  INTERSECT
                  SELECT unnest(a2.genres) FROM lineups.artists a2
                  JOIN lineups.event_artists ea2 ON ea2.artist_id = a2.id
                  WHERE ea2.event_id = e.id
                ) g
              ) AS matched_genres
         FROM agg
         JOIN catalog.events e ON e.id = agg.event_id
        WHERE e.status = 'published' AND e.date_start > NOW()
        ORDER BY agg.total_score DESC, e.date_start ASC
        LIMIT $2`,
      [userId, limit],
    );

    await client.query('COMMIT');

    return NextResponse.json({
      hasConnection: true,
      isMock: conn.rows[0].is_mock,
      count: rows.rows.length,
      events: rows.rows.map((r) => ({
        eventId: r.event_id,
        title: r.title,
        dateStart: r.date_start,
        coverImageUrl: r.cover_image_url,
        score: Number(r.score),
        matchedArtists: r.matched_artists ?? [],
        matchedGenres: r.matched_genres ?? [],
      })),
    });
  } catch (err) {
    await client.query('ROLLBACK').catch(() => undefined);
    console.error('[GET discover/events]', err);
    return NextResponse.json({ error: 'INTERNAL' }, { status: 500 });
  } finally {
    client.release();
  }

  });
}
