/**
 * GET /api/v1/feed/tiktok-catalog.json
 *
 * TikTok Catalog Feed — pro TikTok Shop a TikTok Ads dynamický retargeting.
 *
 * Formát: TikTok Product Feed (kompatibilní s Meta Product Feed + TikTok extensions)
 *   https://ads.tiktok.com/help/article/product-catalog-specifications
 *
 * Query params:
 *   promoter_id — filtr pro konkrétního promotéra (volitelné)
 *
 * Nasazení: TikTok Ads Manager → Assets → Catalog → Add Data Source → URL Feed.
 * Doporučená frekvence: každou hodinu.
 *
 * Cache: 1 hod
 */
import { NextRequest, NextResponse } from 'next/server';
import { db, runWithServiceContext } from '@/lib/db/rls-pool';

interface EventRow {
  id: string;
  title: string;
  description: string | null;
  slug: string | null;
  starts_at: string;
  cover_image_url: string | null;
  min_price: number | null;
  currency: string;
  promoter_name: string;
  promoter_slug: string | null;
  venue_name: string | null;
  venue_city: string | null;
  category: string | null;
  remaining_capacity: number | null;
}

const TIKTOK_CATEGORY_MAP: Record<string, string> = {
  concert:    'Entertainment & Arts > Music Events',
  theatre:    'Entertainment & Arts > Theater',
  festival:   'Entertainment & Arts > Festivals',
  sport:      'Sports & Outdoors > Sports Events',
  comedy:     'Entertainment & Arts > Comedy Shows',
  dance:      'Entertainment & Arts > Dance Events',
  opera:      'Entertainment & Arts > Opera',
  exhibition: 'Entertainment & Arts > Art Exhibitions',
  conference: 'Events > Business Events',
};

export async function GET(req: NextRequest): Promise<Response> {
  return runWithServiceContext(async () => {
    const sp         = req.nextUrl.searchParams;
    const promoterId = sp.get('promoter_id');
    const baseUrl    = process.env.NEXT_PUBLIC_APP_URL ?? 'https://app.tixly.cz';

    const conditions = ["e.status = 'published'", 'e.starts_at > NOW()'];
    const params: unknown[] = [];
    if (promoterId) {
      params.push(promoterId);
      conditions.push(`e.promoter_id = $${params.length}`);
    }

    const rows = await db().query<EventRow>(
      `SELECT e.id, e.title, e.description, e.slug, e.starts_at,
              e.cover_image_url, e.currency, e.category,
              p.name AS promoter_name, p.slug AS promoter_slug,
              v.name AS venue_name, v.city AS venue_city,
              MIN(tt.base_price) AS min_price,
              e.total_capacity - COALESCE(
                (SELECT COUNT(*) FROM orders.order_items oi
                   JOIN orders.orders o ON o.id = oi.order_id
                  WHERE o.event_id = e.id AND o.status = 'paid'), 0
              ) AS remaining_capacity
         FROM catalog.events e
         JOIN catalog.promoters p ON p.id = e.promoter_id
         LEFT JOIN catalog.venues v ON v.id = e.venue_id
         LEFT JOIN catalog.ticket_types tt ON tt.event_id = e.id AND tt.is_active = true
        WHERE ${conditions.join(' AND ')}
        GROUP BY e.id, p.name, p.slug, v.name, v.city
        ORDER BY e.starts_at ASC
        LIMIT 1000`,
      params,
    );

    const items = rows.rows.map((ev) => {
      const eventUrl = ev.slug
        ? `${baseUrl}/cs/p/${ev.slug}`
        : `${baseUrl}/cs/events/${ev.id}`;
      const priceAmount = ev.min_price != null ? (ev.min_price / 100).toFixed(2) : '0.00';
      const availability = (ev.remaining_capacity ?? 1) > 0 ? 'in stock' : 'out of stock';
      const startsDate   = new Date(ev.starts_at).toLocaleDateString('cs-CZ', { day: 'numeric', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit' });
      const locationStr  = [ev.venue_name, ev.venue_city].filter(Boolean).join(', ');

      return {
        // TikTok required fields
        sku_id:        ev.id,
        item_group_id: ev.id,
        title:         ev.title,
        description:   `${ev.description?.slice(0, 500) ?? ev.title}${locationStr ? ` | ${locationStr}` : ''} | ${startsDate}`,
        availability,
        condition:     'new',
        price:         `${priceAmount} ${ev.currency}`,
        link:          eventUrl,
        image_link:    ev.cover_image_url ?? `${baseUrl}/og-default.png`,
        brand:         ev.promoter_name,
        // TikTok category
        product_type:  TIKTOK_CATEGORY_MAP[ev.category ?? ''] ?? 'Entertainment & Arts',
        // Optional but recommended
        custom_label_0: ev.category ?? 'event',
        custom_label_1: ev.venue_city ?? '',
        custom_label_2: new Date(ev.starts_at).toISOString().slice(0, 10),
        // TikTok-specific extensions
        'tiktok:event_start_time': new Date(ev.starts_at).toISOString(),
        'tiktok:venue':            locationStr || undefined,
      };
    });

    return NextResponse.json(
      { data: items },
      {
        headers: {
          'Cache-Control': 'public, s-maxage=3600, stale-while-revalidate=600',
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*',
        },
      },
    );
  });
}

export function OPTIONS() {
  return new Response(null, {
    status: 204,
    headers: { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'GET' },
  });
}
