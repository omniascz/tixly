/**
 * GET /api/public/artists/{slug}
 *
 * Public artist profile: bio, genres, upcoming events, follower count.
 * No auth required.
 */
import { NextRequest, NextResponse } from 'next/server';
import { db, runWithServiceContext } from '@/lib/db/rls-pool';

export const dynamic = 'force-dynamic';

interface ArtistDetailRow {
  id:              string;
  name:            string;
  slug:            string;
  bio:             string | null;
  cover_image_url: string | null;
  genres:          string[] | null;
  country:         string | null;
  spotify_id:      string | null;
  website_url:     string | null;
  social_links:    Record<string, string> | null;
  follower_count:  string;
}

interface EventRow {
  event_id:     string;
  event_title:  string;
  event_slug:   string;
  date_start:   string;
  venue_name:   string | null;
  city:         string | null;
  min_price:    string | null;
  currency:     string;
  is_headliner: boolean;
}

export async function GET(
  _req: NextRequest,
  { params }: { params: { slug: string } },
): Promise<Response> {
  const { slug } = params;

  return runWithServiceContext(async () => {
    const [artistRes, eventsRes] = await Promise.all([
      db().query<ArtistDetailRow>(
        `SELECT
           a.id, a.name, a.slug, a.bio, a.cover_image_url, a.genres, a.country,
           a.spotify_id, a.website_url, a.social_links,
           COUNT(DISTINCT af.user_id)::text AS follower_count
         FROM lineups.artists a
         LEFT JOIN lineups.artist_follows af ON af.artist_id = a.id
         WHERE a.slug = $1
         GROUP BY a.id`,
        [slug],
      ),

      db().query<EventRow>(
        `SELECT
           e.id AS event_id, pr.title AS event_title, e.slug AS event_slug,
           e.date_start, v.name AS venue_name, v.city,
           MIN(tt.price)::text AS min_price,
           COALESCE(MIN(tt.currency), 'CZK') AS currency,
           ea.is_headliner
         FROM lineups.event_artists ea
         JOIN lineups.artists a ON a.id = ea.artist_id
         JOIN catalog.events e ON e.id = ea.event_id
         JOIN catalog.productions pr ON pr.id = e.production_id
         LEFT JOIN catalog.venues v ON v.id = e.venue_id
         LEFT JOIN catalog.ticket_types tt ON tt.event_id = e.id AND tt.status IN ('on_sale','presale')
         WHERE a.slug = $1
           AND e.status = 'published'
           AND e.date_start > NOW()
         GROUP BY e.id, pr.title, e.slug, e.date_start, v.name, v.city, ea.is_headliner
         ORDER BY e.date_start ASC
         LIMIT 20`,
        [slug],
      ),
    ]);

    const artist = artistRes.rows[0];
    if (!artist) {
      return NextResponse.json({ error: 'NOT_FOUND' }, { status: 404 });
    }

    return NextResponse.json(
      {
        id:            artist.id,
        name:          artist.name,
        slug:          artist.slug,
        bio:           artist.bio,
        coverImageUrl: artist.cover_image_url,
        genres:        artist.genres ?? [],
        country:       artist.country,
        spotifyId:     artist.spotify_id,
        websiteUrl:    artist.website_url,
        socialLinks:   artist.social_links ?? {},
        followerCount: Number(artist.follower_count),
        upcomingEvents: eventsRes.rows.map((e) => ({
          id:          e.event_id,
          title:       e.event_title,
          slug:        e.event_slug,
          dateStart:   e.date_start,
          venueName:   e.venue_name,
          city:        e.city,
          minPrice:    e.min_price ? Number(e.min_price) : null,
          currency:    e.currency,
          isHeadliner: e.is_headliner,
        })),
      },
      { headers: { 'Cache-Control': 'public, max-age=300, stale-while-revalidate=60' } },
    );
  });
}
