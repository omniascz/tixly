/**
 * GET /api/artists/[slug] — veřejná artist stránka + nadcházející akce
 * Používá lineups.artists (existující tabulka, promoter-owned).
 */
import { NextRequest, NextResponse } from 'next/server';
import { db, runWithServiceContext } from '@/lib/db/rls-pool';

export async function GET(
  _req: NextRequest,
  { params }: { params: { slug: string } },
): Promise<Response> {
  // Verejna routa: nikoho neautentizuje, takze z ceho brat GUC nema —
  // pod produkci roli tixly_app by RLS odfiltrovalo VSECHNO a routa by
  // vracela prazdno komukoli (FINDINGS 91). Bezi proto v servisnim
  // kontextu; rozhodnuti 'tohle je verejne' tim zustava v aplikaci,
  // ne rozmazane pres USING (true) v policy, ktera by tabulku otevrela
  // i vsem ostatnim cestam bez GUC.
  //
  // Filtrovani je proto na dotazu, ne na RLS: e.status = 'published'
  // (vzorec z FINDINGS 65) + visibility u typu listku.
  return runWithServiceContext(async () => {
    const client = await db().connect();
    try {
      // Public artists: public=true OR no public column yet → fallback to any
      const artistRes = await client.query(
        `SELECT a.id, a.name, a.slug, a.bio, a.cover_image_url, a.genres, a.country,
                a.website_url, a.social_links, a.spotify_id
           FROM lineups.artists a
          WHERE a.slug = $1`,
        [params.slug],
      );
      if (artistRes.rowCount === 0) {
        return NextResponse.json({ error: 'NOT_FOUND' }, { status: 404 });
      }
      const artist = artistRes.rows[0] as {
        id: string; name: string; slug: string; bio: string | null;
        cover_image_url: string | null; genres: string[]; country: string | null;
        website_url: string | null; social_links: Record<string, string> | null; spotify_id: string | null;
      };

      // Upcoming events this artist is linked to (via lineups.event_artists)
      const eventsRes = await client.query(
        `SELECT e.id, e.title, e.slug, e.date_start, e.cover_image_url, e.category,
                v.name AS venue_name, v.city,
                ea.is_headliner,
                (SELECT MIN(tt.base_price) FROM catalog.ticket_types tt
                  WHERE tt.event_id = e.id AND tt.remaining_qty > 0) AS cheapest_ticket_halire,
                p.name AS promoter_name
           FROM lineups.event_artists ea
           JOIN catalog.events e ON e.id = ea.event_id
           JOIN catalog.venues v ON v.id = e.venue_id
           JOIN platform.promoters p ON p.id = e.promoter_id
          WHERE ea.artist_id = $1
            AND e.status = 'published'
            AND e.date_start >= now()
          ORDER BY e.date_start ASC
          LIMIT 20`,
        [artist.id],
      );

      return NextResponse.json({ artist, events: eventsRes.rows });
    } catch (err) {
      console.error('[GET /api/artists/:slug]', err);
      return NextResponse.json({ error: 'INTERNAL' }, { status: 500 });
    } finally {
      client.release();
    }
  });
}
