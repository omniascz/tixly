/**
 * GET /api/v1/feed/events?format=json|csv
 *
 * TM-style Discovery Feed — bulk export všech published events.
 * Pro affiliates a partner integrations. Hourly refresh recommended.
 *
 * Auth: žádná (public feed, jen published events).
 * Cache: 1 hodina (s-maxage=3600).
 *
 * JSON format default. CSV s flat structure.
 */
import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db/rls-pool';


interface FeedEvent {
  id: string;
  title: string;
  slug: string | null;
  date_start: string;
  date_end: string | null;
  category: string | null;
  subcategory: string | null;
  event_type: string;
  cover_image_url: string | null;
  venue_name: string | null;
  venue_city: string | null;
  venue_country: string | null;
  min_price_halire: number | null;
  max_price_halire: number | null;
  currency: string;
  promoter_name: string;
  promoter_slug: string | null;
  total_capacity: number | null;
  remaining_capacity: number | null;
  url: string;
}

function csvEscape(v: unknown): string {
  if (v === null || v === undefined) return '';
  const s = String(v);
  if (/[",\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

export async function GET(req: NextRequest): Promise<Response> {
  const format = (req.nextUrl.searchParams.get('format') ?? 'json').toLowerCase();
  const baseUrl = process.env.NEXT_PUBLIC_APP_URL ?? 'https://app.tixly.cz';

  const r = await db().query<FeedEvent>(
    `SELECT
       e.id, e.title, e.slug, e.date_start::text, e.date_end::text,
       e.category, e.subcategory, e.event_type, e.cover_image_url,
       v.name AS venue_name, v.city AS venue_city, v.country AS venue_country,
       e.currency,
       p.name AS promoter_name, p.slug AS promoter_slug,
       (SELECT SUM(tt.total_qty) FROM catalog.ticket_types tt
          WHERE tt.event_id = e.id)::int AS total_capacity,
       (SELECT SUM(tt.remaining_qty) FROM catalog.ticket_types tt
          WHERE tt.event_id = e.id AND tt.visibility = 'public')::int AS remaining_capacity,
       (SELECT MIN(tt.base_price) FROM catalog.ticket_types tt
          WHERE tt.event_id = e.id AND tt.visibility = 'public')::int AS min_price_halire,
       (SELECT MAX(tt.base_price) FROM catalog.ticket_types tt
          WHERE tt.event_id = e.id AND tt.visibility = 'public')::int AS max_price_halire,
       '${baseUrl}' || '/cs/events/' || COALESCE(e.slug, e.id::text) AS url
     FROM catalog.events e
     LEFT JOIN catalog.venues v ON v.id = e.venue_id
     JOIN platform.promoters p ON p.id = e.promoter_id
     WHERE e.status = 'published'
       AND e.date_start > NOW()
       AND p.status = 'active'
     ORDER BY e.date_start ASC
     LIMIT 5000`,
  );

  if (format === 'csv') {
    const headers = [
      'id', 'title', 'slug', 'date_start', 'date_end',
      'category', 'subcategory', 'event_type',
      'venue_name', 'venue_city', 'venue_country',
      'min_price_halire', 'max_price_halire', 'currency',
      'promoter_name', 'promoter_slug',
      'total_capacity', 'remaining_capacity',
      'url',
    ];
    const lines = r.rows.map((row) =>
      [
        row.id, row.title, row.slug, row.date_start, row.date_end,
        row.category, row.subcategory, row.event_type,
        row.venue_name, row.venue_city, row.venue_country,
        row.min_price_halire, row.max_price_halire, row.currency,
        row.promoter_name, row.promoter_slug,
        row.total_capacity, row.remaining_capacity,
        row.url,
      ].map(csvEscape).join(','),
    );
    const csv = [headers.join(','), ...lines].join('\n');
    return new NextResponse(csv, {
      status: 200,
      headers: {
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': `attachment; filename="tixly-events-feed-${new Date().toISOString().slice(0, 10)}.csv"`,
        'Cache-Control': 'public, s-maxage=3600',
      },
    });
  }

  return NextResponse.json(
    {
      meta: {
        generated_at: new Date().toISOString(),
        count: r.rows.length,
        cache_ttl_seconds: 3600,
      },
      events: r.rows,
    },
    {
      headers: {
        'Cache-Control': 'public, s-maxage=3600',
      },
    },
  );
}
