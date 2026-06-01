/**
 * GET  /api/admin/event-groups    — list všech groups promotéra
 * POST /api/admin/event-groups    — create group
 *
 * TM Parity Fáze 2 — Event Groups.
 *
 * Body POST: { name, slug, groupType, description?, defaultCurrency?, defaultRefundDays?, ... }
 */
import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db/rls-pool';
import { runAsPromoter, runAsPromoterNonStaff } from '@/lib/admin-auth';
import { z } from 'zod';


const postSchema = z.object({
  name: z.string().min(2).max(200),
  slug: z.string().regex(/^[a-z0-9-]{2,80}$/),
  groupType: z.enum(['tour', 'festival', 'series', 'repeating', 'cross_venue']),
  description: z.string().max(2000).optional(),
  coverImageUrl: z.string().url().optional(),
  brandColorHex: z.string().regex(/^#[0-9a-f]{6}$/i).optional(),
  defaultCurrency: z.string().length(3).optional(),
  defaultRefundDays: z.number().int().min(0).max(365).optional(),
  defaultQrPolicy: z.string().optional(),
  defaultMinAge: z.number().int().min(0).max(99).optional(),
});

export async function GET(req: NextRequest): Promise<Response> {
  return runAsPromoter(req, async (promoter) => {
  const r = await db().query<{
    id: string;
    name: string;
    slug: string;
    group_type: string;
    status: string;
    description: string | null;
    cover_image_url: string | null;
    brand_color_hex: string | null;
    event_count: string;
    onsale_coordinated_at: string | null;
    created_at: string;
  }>(
    `SELECT g.id, g.name, g.slug, g.group_type, g.status,
            g.description, g.cover_image_url, g.brand_color_hex,
            g.onsale_coordinated_at::text,
            (SELECT COUNT(*)::text FROM event_groups.members WHERE group_id = g.id) AS event_count,
            g.created_at::text
       FROM event_groups.groups g
      WHERE g.promoter_id = $1
      ORDER BY g.created_at DESC
      LIMIT 200`,
    [promoter.promoterId],
  );

  return NextResponse.json({
    groups: r.rows.map((row) => ({
      id: row.id,
      name: row.name,
      slug: row.slug,
      groupType: row.group_type,
      status: row.status,
      description: row.description,
      coverImageUrl: row.cover_image_url,
      brandColorHex: row.brand_color_hex,
      eventCount: Number(row.event_count),
      onsaleCoordinatedAt: row.onsale_coordinated_at,
      createdAt: row.created_at,
    })),
  });

  });
}

export async function POST(req: NextRequest): Promise<Response> {
  return runAsPromoterNonStaff(req, async (promoter) => {
  const body: unknown = await req.json().catch(() => ({}));
  const parsed = postSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: 'INVALID_BODY', issues: parsed.error.issues }, { status: 422 });
  }
  const d = parsed.data;

  try {
    const r = await db().query<{ id: string }>(
      `INSERT INTO event_groups.groups
         (promoter_id, name, slug, group_type, description,
          cover_image_url, brand_color_hex,
          default_currency, default_refund_days, default_qr_policy, default_min_age)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
       RETURNING id`,
      [
        promoter.promoterId,
        d.name, d.slug, d.groupType, d.description ?? null,
        d.coverImageUrl ?? null, d.brandColorHex ?? null,
        d.defaultCurrency ?? null, d.defaultRefundDays ?? null,
        d.defaultQrPolicy ?? null, d.defaultMinAge ?? null,
      ],
    );
    return NextResponse.json({ id: r.rows[0].id, slug: d.slug }, { status: 201 });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg.includes('duplicate key')) {
      return NextResponse.json({ error: 'SLUG_TAKEN' }, { status: 409 });
    }
    console.error('[POST /api/admin/event-groups]', err);
    return NextResponse.json({ error: 'INTERNAL' }, { status: 500 });
  }

  });
}
