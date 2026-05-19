/**
 * Super Admin endpoints pro editorial články.
 *
 * GET    /api/platform/editorial             — list všech (draft + published)
 * POST   /api/platform/editorial             — create article
 * PATCH  /api/platform/editorial?id=         — update
 *
 * Auth: x-internal-token (zatím; v produkci napojit na is_platform_admin).
 */

import { timingSafeEqual } from 'crypto';
import { NextRequest, NextResponse } from 'next/server';
import { Pool } from 'pg';
import { z } from 'zod';

let pool: Pool | null = null;
function db(): Pool {
  if (!pool) pool = new Pool({ connectionString: process.env.DATABASE_URL });
  return pool;
}

function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a, 'utf8');
  const bb = Buffer.from(b, 'utf8');
  if (ab.length !== bb.length) return false;
  return timingSafeEqual(ab, bb);
}

function isAdmin(req: NextRequest): boolean {
  const token = req.headers.get('x-internal-token') ?? '';
  const expected = process.env.INTERNAL_SERVICE_TOKEN ?? '';
  return Boolean(expected) && safeEqual(token, expected);
}

const upsertSchema = z.object({
  slug: z.string().regex(/^[a-z0-9-]+$/).min(3).max(120),
  title: z.string().min(3).max(200),
  excerpt: z.string().max(500).optional(),
  bodyHtml: z.string().min(50).max(100000),
  coverImage: z.string().url().optional(),
  category: z.string().max(80).optional(),
  status: z.enum(['draft', 'published', 'archived']).default('draft'),
  readingTimeMin: z.number().int().min(1).max(60).optional(),
  featuredEventIds: z.array(z.string().uuid()).max(20).optional(),
});

export async function GET(req: NextRequest): Promise<Response> {
  if (!isAdmin(req)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const r = await db().query(
    `SELECT id, slug, title, excerpt, category, status, view_count,
            published_at, created_at, updated_at
     FROM marketing.editorial_articles
     ORDER BY updated_at DESC
     LIMIT 200`,
  );
  return NextResponse.json({ articles: r.rows });
}

export async function POST(req: NextRequest): Promise<Response> {
  if (!isAdmin(req)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const body: unknown = await req.json().catch(() => ({}));
  const parsed = upsertSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: 'BAD_INPUT', issues: parsed.error.issues }, { status: 422 });
  }

  const client = await db().connect();
  try {
    await client.query('BEGIN');
    const r = await client.query<{ id: string }>(
      `INSERT INTO marketing.editorial_articles
         (slug, title, excerpt, body_html, cover_image, category, status,
          reading_time_min, published_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8,
               CASE WHEN $7 = 'published' THEN NOW() ELSE NULL END)
       RETURNING id`,
      [
        parsed.data.slug,
        parsed.data.title,
        parsed.data.excerpt ?? null,
        parsed.data.bodyHtml,
        parsed.data.coverImage ?? null,
        parsed.data.category ?? null,
        parsed.data.status,
        parsed.data.readingTimeMin ?? null,
      ],
    );
    const articleId = r.rows[0].id;

    if (parsed.data.featuredEventIds && parsed.data.featuredEventIds.length > 0) {
      for (let i = 0; i < parsed.data.featuredEventIds.length; i++) {
        await client.query(
          `INSERT INTO marketing.editorial_article_events
             (article_id, event_id, display_order)
           VALUES ($1, $2, $3)
           ON CONFLICT DO NOTHING`,
          [articleId, parsed.data.featuredEventIds[i], i],
        );
      }
    }

    await client.query('COMMIT');
    return NextResponse.json({ ok: true, id: articleId });
  } catch (err) {
    await client.query('ROLLBACK');
    const code = (err as { code?: string }).code;
    if (code === '23505') {
      return NextResponse.json({ error: 'DUPLICATE_SLUG' }, { status: 409 });
    }
    throw err;
  } finally {
    client.release();
  }
}
