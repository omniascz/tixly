import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db/rls-pool';
import { runAsActivePromoter } from '@/lib/admin-auth';
import {
  cardColumns,
  PRODUCTION_COLUMNS,
  productionCardSchema,
  toProductionCard,
  type ProductionRow as CardRow,
} from '@/lib/theatre/production-card';

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

// Kolo 8: celá karta inscenace (lib/theatre/production-card.ts).
const postSchema = productionCardSchema;

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
          .normalize('NFD').replace(/\p{Diacritic}/gu, '')
          .replace(/[^a-z0-9]+/g, '-')
          .replace(/^-|-$/g, '')
          .slice(0, 100);

    const cols = cardColumns({ ...parsed.data, title: undefined });
    const names = ['promoter_id', 'title', 'slug', ...cols.map(([c]) => c)];
    const values = [promoter.promoterId, parsed.data.title, slug, ...cols.map(([, v]) => v)];
    const r = await db().query<CardRow>(
      `INSERT INTO catalog.productions AS p (${names.join(', ')}, created_at)
       VALUES (${values.map((_, i) => `$${i + 1}`).join(', ')}, NOW())
       RETURNING ${PRODUCTION_COLUMNS}`,
      values,
    );

    return NextResponse.json({ production: toProductionCard(r.rows[0]) }, { status: 201 });
  });
}
