/**
 * GET/POST /api/admin/event-templates
 *
 * Reusable templates (presale setup, VIP packages, discount bundles).
 * Promotér si nadefinuje šablonu jednou, aplikuje na N akcí.
 */
import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db/rls-pool';
import { runAsPromoter, runAsPromoterNonStaff } from '@/lib/admin-auth';
import { z } from 'zod';


const postSchema = z.object({
  name: z.string().min(2).max(200),
  description: z.string().max(2000).optional(),
  templateType: z.enum(['full_event', 'presale_setup', 'vip_package', 'discount_bundle', 'pricing_tiers']),
  templateData: z.record(z.string(), z.unknown()),
  previewImageUrl: z.string().url().optional(),
});

export async function GET(req: NextRequest): Promise<Response> {
  return runAsPromoter(req, async (promoter) => {
  const r = await db().query(
    `SELECT id, name, description, template_type, template_data,
            preview_image_url, usage_count, is_active, created_at::text
       FROM catalog.event_templates
      WHERE promoter_id = $1 AND is_active = true
   ORDER BY usage_count DESC, created_at DESC`,
    [promoter.promoterId],
  );

  return NextResponse.json({ templates: r.rows });

  });
}

export async function POST(req: NextRequest): Promise<Response> {
  return runAsPromoterNonStaff(req, async (promoter) => {
  const body: unknown = await req.json().catch(() => ({}));
  const parsed = postSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: 'INVALID_BODY' }, { status: 422 });

  const r = await db().query<{ id: string }>(
    `INSERT INTO catalog.event_templates
       (promoter_id, name, description, template_type, template_data, preview_image_url, created_by_user_id)
     VALUES ($1, $2, $3, $4, $5::jsonb, $6, $7)
     RETURNING id`,
    [
      promoter.promoterId, parsed.data.name, parsed.data.description ?? null,
      parsed.data.templateType, JSON.stringify(parsed.data.templateData),
      parsed.data.previewImageUrl ?? null, promoter.userId,
    ],
  );

  return NextResponse.json({ id: r.rows[0].id }, { status: 201 });

  });
}
