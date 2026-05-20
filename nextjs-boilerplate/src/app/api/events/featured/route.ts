/**
 * GET /api/events/featured — public endpoint, vrátí "Tipy redakce" akce.
 *
 * Auto-filtruje akce kde:
 *   - editorial_featured = true
 *   - status = 'published'
 *   - date_start > NOW() (nezobrazujeme minulé)
 *   - editorial_until je NULL nebo > NOW() (expirace platí)
 *
 * Order: editorial_order DESC, date_start ASC.
 * Limit: max 12, default 6.
 */
import { NextRequest, NextResponse } from 'next/server';
import { Pool } from 'pg';

let pool: Pool | null = null;
function db(): Pool {
  if (!pool) pool = new Pool({ connectionString: process.env.DATABASE_URL });
  return pool;
}

interface FeaturedEvent {
  id: string;
  title: string;
  slug: string | null;
  date_start: string;
  city: string | null;
  venue_name: string | null;
  cover_image: string | null;
  promoter_name: string;
  promoter_slug: string;
  brand_color_hex: string | null;
  editorial_blurb: string | null;
  min_price_halire: number | null;
  currency: string;
}

export async function GET(req: NextRequest): Promise<Response> {
  const limit = Math.min(Math.max(Number(req.nextUrl.searchParams.get('limit') ?? '6'), 1), 12);

  const r = await db().query<FeaturedEvent>(
    `SELECT e.id, e.title, e.slug, e.date_start::text, e.cover_image_url AS cover_image,
            v.city, v.name AS venue_name,
            p.name AS promoter_name, p.slug AS promoter_slug, p.brand_color_hex,
            e.editorial_blurb,
            (SELECT MIN(base_price) FROM catalog.ticket_types
              WHERE event_id = e.id AND visibility = 'public') AS min_price_halire,
            COALESCE(e.currency, 'CZK') AS currency
       FROM catalog.events e
       LEFT JOIN catalog.venues v ON v.id = e.venue_id
       LEFT JOIN platform.promoters p ON p.id = e.promoter_id
      WHERE e.editorial_featured = true
        AND e.status = 'published'
        AND e.date_start > NOW()
        AND (e.editorial_until IS NULL OR e.editorial_until > NOW())
      ORDER BY e.editorial_order DESC, e.date_start ASC
      LIMIT $1`,
    [limit],
  );

  return NextResponse.json(
    {
      events: r.rows.map((e) => ({
        id: e.id,
        title: e.title,
        slug: e.slug,
        dateStart: e.date_start,
        city: e.city,
        venueName: e.venue_name,
        coverImage: e.cover_image,
        promoterName: e.promoter_name,
        promoterSlug: e.promoter_slug,
        brandColorHex: e.brand_color_hex,
        editorialBlurb: e.editorial_blurb,
        minPriceHalire: e.min_price_halire,
        currency: e.currency,
      })),
    },
    {
      status: 200,
      headers: { 'Cache-Control': 'public, s-maxage=300, stale-while-revalidate=600' },
    },
  );
}
