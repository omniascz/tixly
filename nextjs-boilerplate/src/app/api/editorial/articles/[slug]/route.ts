/**
 * GET /api/editorial/articles/[slug]
 * Veřejný detail editorialního článku — inkrementuje view_count.
 */
import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db/rls-pool';

export const dynamic = 'force-dynamic';

export async function GET(
  _req: NextRequest,
  { params }: { params: { slug: string } },
): Promise<Response> {
  const client = await db().connect();
  try {
    const r = await client.query<{
      id: string; slug: string; title: string; excerpt: string | null;
      body_html: string; cover_image: string | null; category: string | null;
      reading_time_min: number | null; view_count: number; published_at: string;
    }>(
      `SELECT id, slug, title, excerpt, body_html, cover_image, category,
              reading_time_min, view_count, published_at
         FROM marketing.editorial_articles
        WHERE slug = $1 AND status = 'published'`,
      [params.slug],
    );

    if (r.rows.length === 0) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 });
    }

    const article = r.rows[0];

    // Načíst doporučené akce k článku
    const events = await client.query<{
      id: string; title: string; slug: string | null; date_start: string;
      cover_image_url: string | null; city: string | null; venue_name: string | null;
      min_price_halire: number | null; currency: string;
    }>(
      `SELECT e.id, e.title, e.slug, e.date_start::text,
              e.cover_image_url, v.city, v.name AS venue_name,
              MIN(tt.price_halire) AS min_price_halire, e.currency
         FROM marketing.editorial_article_events eae
         JOIN catalog.events e ON e.id = eae.event_id
         LEFT JOIN catalog.venues v ON v.id = e.venue_id
         LEFT JOIN catalog.ticket_types tt ON tt.event_id = e.id AND tt.is_hidden = false
        WHERE eae.article_id = $1 AND e.status = 'published' AND e.date_start > NOW()
        GROUP BY e.id, e.title, e.slug, e.date_start, e.cover_image_url,
                 v.city, v.name, e.currency
        ORDER BY eae.display_order ASC, e.date_start ASC
        LIMIT 6`,
      [article.id],
    );

    // Increment view_count asynchronously
    void client.query(
      `UPDATE marketing.editorial_articles SET view_count = view_count + 1 WHERE id = $1`,
      [article.id],
    ).catch(() => undefined);

    return NextResponse.json({ article, events: events.rows });
  } finally {
    client.release();
  }
}
