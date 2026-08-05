/**
 * GET /api/discover
 *
 * Centrální discovery API — vrací veřejně dostupné eventy napříč všemi promotéry.
 * Query params: q (search), city, category, date_from, date_to, page (default 1), limit (default 24)
 */
import { NextRequest, NextResponse } from 'next/server';
import { db, runWithServiceContext } from '@/lib/db/rls-pool';

export async function GET(req: NextRequest): Promise<Response> {
  const sp = req.nextUrl.searchParams;
  const q = (sp.get('q') ?? '').trim();
  const city = (sp.get('city') ?? '').trim();
  const category = (sp.get('category') ?? '').trim();
  const dateFrom = sp.get('date_from');
  const dateTo = sp.get('date_to');
  const page = Math.max(1, parseInt(sp.get('page') ?? '1'));
  const limit = Math.min(48, Math.max(1, parseInt(sp.get('limit') ?? '24')));
  const offset = (page - 1) * limit;

  const conditions: string[] = ["e.status = 'published'", "e.date_start >= now()"];
  const values: unknown[] = [];
  let idx = 1;

  if (q) {
    conditions.push(`(e.title ILIKE $${idx} OR e.description ILIKE $${idx})`);
    values.push(`%${q}%`);
    idx++;
  }
  if (city) {
    conditions.push(`v.city ILIKE $${idx}`);
    values.push(`%${city}%`);
    idx++;
  }
  if (category) {
    conditions.push(`e.category = $${idx}`);
    values.push(category);
    idx++;
  }
  if (dateFrom) {
    conditions.push(`e.date_start >= $${idx}`);
    values.push(dateFrom);
    idx++;
  }
  if (dateTo) {
    conditions.push(`e.date_start <= $${idx}`);
    values.push(dateTo);
    idx++;
  }

  const where = `WHERE ${conditions.join(' AND ')}`;

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
      const [eventsRes, countRes, citiesRes] = await Promise.all([
        client.query(
          `SELECT
             e.id, e.title, e.slug, e.date_start, e.date_end,
             e.cover_image_url, e.category,
             (SELECT MIN(tt.base_price) FROM catalog.ticket_types tt
               WHERE tt.event_id = e.id AND tt.remaining_qty > 0 AND tt.visibility = 'public') AS min_price_halire,
             (SELECT MAX(tt.base_price) FROM catalog.ticket_types tt
               WHERE tt.event_id = e.id AND tt.visibility = 'public') AS max_price_halire,
             e.currency,
             v.name AS venue_name, v.city, v.address,
             p.name AS promoter_name, p.brand_color_hex, p.brand_logo_url,
             (SELECT MIN(tt.base_price) FROM catalog.ticket_types tt
               WHERE tt.event_id = e.id AND tt.remaining_qty > 0 AND tt.visibility = 'public') AS cheapest_ticket_halire,
             (SELECT SUM(tt.remaining_qty) FROM catalog.ticket_types tt
               WHERE tt.event_id = e.id AND tt.visibility = 'public') AS total_remaining,
             COALESCE(
               (SELECT json_agg(json_build_object('name', a.name, 'photo_url', a.image_url, 'role', CASE WHEN ea.is_headliner THEN 'headliner' ELSE 'support' END)
                  ORDER BY ea.order_index)
                FROM lineups.event_artists ea
                JOIN lineups.artists a ON a.id = ea.artist_id
               WHERE ea.event_id = e.id), '[]'::json
             ) AS artists
           FROM catalog.events e
           JOIN catalog.venues v ON v.id = e.venue_id
           JOIN platform.promoters p ON p.id = e.promoter_id
           ${where}
           ORDER BY e.date_start ASC
           LIMIT $${idx} OFFSET $${idx + 1}`,
          [...values, limit, offset],
        ),
        client.query(
          `SELECT COUNT(*) AS total
             FROM catalog.events e
             JOIN catalog.venues v ON v.id = e.venue_id
             ${where}`,
          values,
        ),
        // Cities with upcoming events (for filter UI)
        client.query(
          `SELECT DISTINCT v.city, COUNT(e.id) AS event_count
             FROM catalog.events e
             JOIN catalog.venues v ON v.id = e.venue_id
            WHERE e.status = 'published' AND e.date_start >= now() AND v.city IS NOT NULL
            GROUP BY v.city ORDER BY event_count DESC LIMIT 20`,
        ),
      ]);

      return NextResponse.json({
        events: eventsRes.rows,
        total: parseInt(countRes.rows[0]?.total ?? '0'),
        page,
        limit,
        totalPages: Math.ceil(parseInt(countRes.rows[0]?.total ?? '0') / limit),
        cities: citiesRes.rows,
      });
    } catch (err) {
      console.error('[GET /api/discover]', err);
      return NextResponse.json({ error: 'INTERNAL' }, { status: 500 });
    } finally {
      client.release();
    }
  });
}
