import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db/rls-pool';
import { runAsActivePromoter } from '@/lib/admin-auth';
import { z } from 'zod';

interface ProductionRow {
  id: string;
  title: string;
  slug: string;
  promoter_id: string;
  created_at: string;
  event_count: number;
}

export async function GET(req: NextRequest): Promise<Response> {
  return runAsActivePromoter(req, async (promoter) => {
    const r = await db().query<ProductionRow>(
      `SELECT p.id, p.title, p.slug, p.promoter_id, p.created_at::text,
              COUNT(e.id)::int AS event_count
         FROM catalog.productions p
         LEFT JOIN catalog.events e ON e.production_id = p.id
        WHERE p.promoter_id = $1
        GROUP BY p.id
        ORDER BY p.created_at DESC`,
      [promoter.promoterId],
    );
    return NextResponse.json({ productions: r.rows });
  });
}

const postSchema = z.object({
  title: z.string().min(1).max(200),
  slug: z.string().min(1).max(100).regex(/^[a-z0-9-]+$/).optional(),
});

export async function POST(req: NextRequest): Promise<Response> {
  return runAsActivePromoter(req, async (promoter) => {
    const body: unknown = await req.json().catch(() => ({}));
    const parsed = postSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ error: 'INVALID_BODY', issues: parsed.error.issues }, { status: 422 });
    }

    const slug = parsed.data.slug
      ?? parsed.data.title
          .toLowerCase()
          .replace(/[^a-z0-9]+/g, '-')
          .replace(/^-|-$/g, '')
          .slice(0, 100);

    const r = await db().query<{ id: string; title: string; slug: string; created_at: string }>(
      `INSERT INTO catalog.productions (promoter_id, title, slug, created_at)
       VALUES ($1, $2, $3, NOW())
       RETURNING id, title, slug, created_at::text`,
      [promoter.promoterId, parsed.data.title, slug],
    );

    return NextResponse.json({ production: r.rows[0] }, { status: 201 });
  });
}
