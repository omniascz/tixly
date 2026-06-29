/**
 * GET /api/editorial/articles
 * Veřejný seznam publikovaných editorialních článků.
 * ?category=tip   — filtrovat podle kategorie
 * ?limit=12       — max počet (default 12, max 50)
 */
import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db/rls-pool';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest): Promise<Response> {
  const url = req.nextUrl;
  const category = url.searchParams.get('category')?.trim();
  const limit = Math.min(Math.max(Number(url.searchParams.get('limit') ?? '12'), 1), 50);

  const conditions = [`status = 'published'`];
  const params: (string | number)[] = [];
  let p = 1;

  if (category) {
    conditions.push(`category = $${p++}`);
    params.push(category);
  }

  params.push(limit);

  const r = await db().query<{
    id: string; slug: string; title: string; excerpt: string | null;
    cover_image: string | null; category: string | null;
    reading_time_min: number | null; view_count: number; published_at: string;
  }>(
    `SELECT id, slug, title, excerpt, cover_image, category, reading_time_min, view_count, published_at
       FROM marketing.editorial_articles
      WHERE ${conditions.join(' AND ')}
      ORDER BY published_at DESC
      LIMIT $${p}`,
    params,
  );

  // Dostupné kategorie
  const cats = await db().query<{ category: string; cnt: string }>(
    `SELECT category, COUNT(*)::text AS cnt
       FROM marketing.editorial_articles
      WHERE status = 'published' AND category IS NOT NULL
      GROUP BY category ORDER BY cnt::int DESC`,
  );

  return NextResponse.json({
    articles: r.rows,
    categories: cats.rows,
    total: r.rowCount,
  });
}
