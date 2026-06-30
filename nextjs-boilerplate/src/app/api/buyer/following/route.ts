/**
 * GET /api/buyer/following
 *
 * Returns the authenticated user's followed artists and their upcoming events.
 * Used on the "Following" tab / personalized homepage.
 */
import { NextRequest, NextResponse } from 'next/server';
import { runAsUser } from '@/lib/auth';
import { db } from '@/lib/db/rls-pool';

export const dynamic = 'force-dynamic';

interface FollowedArtistRow {
  artist_id:       string;
  artist_name:     string;
  artist_slug:     string;
  cover_image_url: string | null;
  genres:          string[] | null;
  followed_at:     string;
}

interface UpcomingEventRow {
  artist_id:   string;
  event_id:    string;
  event_title: string;
  event_slug:  string;
  date_start:  string;
  venue_name:  string | null;
  city:        string | null;
  min_price:   string | null;
  currency:    string;
  is_headliner: boolean;
}

export async function GET(req: NextRequest): Promise<Response> {
  return runAsUser(req, async (userId) => {
    const [artistsRes, eventsRes] = await Promise.all([
      db().query<FollowedArtistRow>(
        `SELECT
           a.id AS artist_id, a.name AS artist_name, a.slug AS artist_slug,
           a.cover_image_url, a.genres,
           af.created_at AS followed_at
         FROM lineups.artist_follows af
         JOIN lineups.artists a ON a.id = af.artist_id
         WHERE af.user_id = $1
         ORDER BY af.created_at DESC`,
        [userId],
      ),

      db().query<UpcomingEventRow>(
        `SELECT DISTINCT
           ea.artist_id,
           e.id AS event_id,
           pr.title AS event_title,
           e.slug AS event_slug,
           e.date_start,
           v.name AS venue_name,
           v.city,
           MIN(tt.base_price)::text AS min_price,
           COALESCE(MIN(e.currency), 'CZK') AS currency,
           ea.is_headliner
         FROM lineups.artist_follows af
         JOIN lineups.event_artists ea ON ea.artist_id = af.artist_id
         JOIN catalog.events e ON e.id = ea.event_id
         JOIN catalog.productions pr ON pr.id = e.production_id
         LEFT JOIN catalog.venues v ON v.id = e.venue_id
         LEFT JOIN catalog.ticket_types tt ON tt.event_id = e.id AND tt.remaining_qty > 0
         WHERE af.user_id = $1
           AND e.status = 'published'
           AND e.date_start > NOW()
         GROUP BY ea.artist_id, e.id, pr.title, e.slug, e.date_start, v.name, v.city, ea.is_headliner
         ORDER BY e.date_start ASC
         LIMIT 50`,
        [userId],
      ),
    ]);

    // Group events by artist_id
    const eventsByArtist = new Map<string, UpcomingEventRow[]>();
    for (const ev of eventsRes.rows) {
      if (!eventsByArtist.has(ev.artist_id)) eventsByArtist.set(ev.artist_id, []);
      eventsByArtist.get(ev.artist_id)!.push(ev);
    }

    const artists = artistsRes.rows.map((a) => ({
      id:            a.artist_id,
      name:          a.artist_name,
      slug:          a.artist_slug,
      coverImageUrl: a.cover_image_url,
      genres:        a.genres ?? [],
      followedAt:    a.followed_at,
      upcomingEvents: (eventsByArtist.get(a.artist_id) ?? []).map((ev) => ({
        id:          ev.event_id,
        title:       ev.event_title,
        slug:        ev.event_slug,
        dateStart:   ev.date_start,
        venueName:   ev.venue_name,
        city:        ev.city,
        minPrice:    ev.min_price ? Number(ev.min_price) : null,
        currency:    ev.currency,
        isHeadliner: ev.is_headliner,
      })),
    }));

    return NextResponse.json({ artists, total: artists.length });
  });
}
