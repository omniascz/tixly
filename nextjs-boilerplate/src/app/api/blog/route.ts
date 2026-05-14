/**
 * GET /api/blog          — list published articles
 * GET /api/blog?slug=    — single article by slug + featured events
 *
 * Public endpoint, no auth.
 */

import { NextRequest, NextResponse } from 'next/server';
import { Pool } from 'pg';

let pool: Pool | null = null;
function db(): Pool {
  if (!pool) pool = new Pool({ connectionString: process.env.DATABASE_URL });
  return pool;
}

export async function GET(req: NextRequest): Promise<Response> {
  const slug = req.nextUrl.searchParams.get('slug');
  const category = req.nextUrl.searchParams.get('category');

  if (slug) {
    const article = await db().query(
      `SELECT id, slug, title, excerpt, body_html, cover_image, category,
              reading_time_min, view_count, published_at, author_user_id
       FROM marketing.editorial_articles
       WHERE slug = $1 AND status = 'published'`,
      [slug],
    );
    if (article.rows.length === 0) {
      return NextResponse.json({ error: 'NOT_FOUND' }, { status: 404 });
    }
    const a = article.rows[0]!;

    // Featured events
    const events = await db().query(
      `SELECT e.id, e.title, e.slug, e.date_start::text,
              v.city, v.name AS venue_name, e.cover_image,
              (SELECT MIN(tt.base_price) FROM catalog.ticket_types tt
               WHERE tt.event_id = e.id AND tt.remaining_qty > 0) AS cheapest_price_halire
       FROM marketing.editorial_article_events aev
       JOIN catalog.events e ON e.id = aev.event_id
       LEFT JOIN catalog.venues v ON v.id = e.venue_id
       WHERE aev.article_id = $1 AND e.status = 'published'
       ORDER BY aev.display_order ASC, e.date_start ASC`,
      [a.id],
    );

    // Increment view_count (fire-and-forget)
    void db().query(
      `UPDATE marketing.editorial_articles SET view_count = view_count + 1 WHERE id = $1`,
      [a.id],
    );

    return NextResponse.json({
      article: a,
      featuredEvents: events.rows,
    });
  }

  // List
  const args: unknown[] = [];
  let categoryClause = '';
  if (category) {
    args.push(category);
    categoryClause = ` AND category = $${args.length}`;
  }
  const r = await db().query(
    `SELECT id, slug, title, excerpt, cover_image, category, reading_time_min,
            view_count, published_at
     FROM marketing.editorial_articles
     WHERE status = 'published' ${categoryClause}
     ORDER BY published_at DESC NULLS LAST
     LIMIT 50`,
    args,
  );

  return NextResponse.json({ articles: r.rows });
}
