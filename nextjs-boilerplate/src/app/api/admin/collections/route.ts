/**
 * GET/POST /api/admin/collections
 *
 * Eventbrite Collections — curated event lists per promotér nebo platform-wide.
 */
import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db/rls-pool';
import { runAsPromoter, runAsPromoterNonStaff } from '@/lib/admin-auth';
import { z } from 'zod';


const postSchema = z.object({
  slug: z.string().regex(/^[a-z0-9-]{2,80}$/),
  title: z.string().min(2).max(200),
  subtitle: z.string().max(300).optional(),
  description: z.string().max(2000).optional(),
  coverImageUrl: z.string().url().optional(),
  displayStyle: z.enum(['grid', 'list', 'carousel', 'masonry']).default('grid'),
  isPublic: z.boolean().default(true),
  isFeatured: z.boolean().default(false),
  autoFilter: z.record(z.string(), z.unknown()).optional(),
});

export async function GET(req: NextRequest): Promise<Response> {
  return runAsPromoter(req, async (promoter) => {
  const r = await db().query(
    `SELECT c.*,
            (SELECT COUNT(*)::int FROM catalog.collection_events
              WHERE collection_id = c.id) AS event_count
       FROM catalog.event_collections c
      WHERE c.promoter_id = $1 OR (c.promoter_id IS NULL AND c.is_public = true)
   ORDER BY c.display_order, c.created_at DESC`,
    [promoter.promoterId],
  );

  return NextResponse.json({ collections: r.rows });

  });
}

export async function POST(req: NextRequest): Promise<Response> {
  return runAsPromoterNonStaff(req, async (promoter) => {
  const body: unknown = await req.json().catch(() => ({}));
  const parsed = postSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: 'INVALID_BODY' }, { status: 422 });
  const d = parsed.data;

  try {
    const r = await db().query<{ id: string }>(
      `INSERT INTO catalog.event_collections
         (promoter_id, slug, title, subtitle, description, cover_image_url,
          display_style, is_public, is_featured, auto_filter, created_by_user_id)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10::jsonb, $11)
       RETURNING id`,
      [
        promoter.promoterId, d.slug, d.title, d.subtitle ?? null, d.description ?? null,
        d.coverImageUrl ?? null, d.displayStyle, d.isPublic, d.isFeatured,
        d.autoFilter ? JSON.stringify(d.autoFilter) : null,
        promoter.userId,
      ],
    );
    return NextResponse.json({ id: r.rows[0].id }, { status: 201 });
  } catch (e) {
    if ((e as { code?: string }).code === '23505') {
      return NextResponse.json({ error: 'DUPLICATE_SLUG' }, { status: 409 });
    }
    return NextResponse.json({ error: 'DB_ERROR' }, { status: 500 });
  }

  });
}
