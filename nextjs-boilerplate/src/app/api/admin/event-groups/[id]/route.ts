/**
 * GET    /api/admin/event-groups/[id]                — detail (group + members + shares)
 * PATCH  /api/admin/event-groups/[id]                — update group fields
 * DELETE /api/admin/event-groups/[id]                — soft-archive (status='archived')
 *
 * Sub-endpoints v jiných route.ts:
 *   POST /api/admin/event-groups/[id]/members          — přidat event
 *   DELETE /api/admin/event-groups/[id]/members/[eid]  — odebrat event
 *   POST /api/admin/event-groups/[id]/bulk-edit        — bulk edit členů
 *   POST /api/admin/event-groups/[id]/coordinate-onsale — synchronni onsale
 *   POST /api/admin/event-groups/[id]/shares           — share s jiným promotérem
 */
import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db/rls-pool';
import { runAsPromoter, runAsPromoterNonStaff } from '@/lib/admin-auth';
import { z } from 'zod';


async function ownsGroup(groupId: string, promoterId: string): Promise<boolean> {
  const r = await db().query(
    `SELECT 1 FROM event_groups.groups WHERE id = $1 AND promoter_id = $2`,
    [groupId, promoterId],
  );
  return r.rows.length > 0;
}

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  return runAsPromoter(req, async (promoter) => {
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) {
    return NextResponse.json({ error: 'INVALID_ID' }, { status: 400 });
  }
  if (!(await ownsGroup(id, promoter.promoterId))) {
    return NextResponse.json({ error: 'NOT_FOUND' }, { status: 404 });
  }

  const groupRes = await db().query<{
    id: string;
    name: string;
    slug: string;
    group_type: string;
    status: string;
    description: string | null;
    cover_image_url: string | null;
    brand_color_hex: string | null;
    default_currency: string | null;
    default_refund_days: number | null;
    default_qr_policy: string | null;
    default_min_age: number | null;
    onsale_coordinated_at: string | null;
    created_at: string;
  }>(
    `SELECT id, name, slug, group_type, status, description,
            cover_image_url, brand_color_hex,
            default_currency, default_refund_days,
            default_qr_policy, default_min_age,
            onsale_coordinated_at::text, created_at::text
       FROM event_groups.groups WHERE id = $1`,
    [id],
  );

  const membersRes = await db().query<{
    event_id: string;
    title: string;
    slug: string | null;
    date_start: string;
    status: string;
    order_index: number;
    is_primary: boolean;
  }>(
    `SELECT m.event_id, e.title, e.slug, e.date_start::text, e.status,
            m.order_index, m.is_primary
       FROM event_groups.members m
       JOIN catalog.events e ON e.id = m.event_id
      WHERE m.group_id = $1
      ORDER BY m.order_index ASC, e.date_start ASC`,
    [id],
  );

  const sharesRes = await db().query<{
    id: string;
    shared_with_promoter_id: string;
    shared_with_name: string;
    status: string;
    can_edit_events: boolean;
    can_publish: boolean;
    can_manage_inventory: boolean;
    can_view_reports: boolean;
    accepted_at: string | null;
    created_at: string;
  }>(
    `SELECT s.id, s.shared_with_promoter_id,
            p.name AS shared_with_name, s.status,
            s.can_edit_events, s.can_publish, s.can_manage_inventory, s.can_view_reports,
            s.accepted_at::text, s.created_at::text
       FROM event_groups.shares s
       JOIN platform.promoters p ON p.id = s.shared_with_promoter_id
      WHERE s.group_id = $1`,
    [id],
  );

  return NextResponse.json({
    group: groupRes.rows[0],
    members: membersRes.rows,
    shares: sharesRes.rows,
  });

  });
}

const patchSchema = z.object({
  name: z.string().min(2).max(200).optional(),
  description: z.string().max(2000).optional(),
  coverImageUrl: z.string().url().nullable().optional(),
  brandColorHex: z.string().regex(/^#[0-9a-f]{6}$/i).nullable().optional(),
  status: z.enum(['draft', 'active', 'completed', 'archived']).optional(),
  defaultCurrency: z.string().length(3).nullable().optional(),
  defaultRefundDays: z.number().int().min(0).max(365).nullable().optional(),
  defaultQrPolicy: z.string().nullable().optional(),
  defaultMinAge: z.number().int().min(0).max(99).nullable().optional(),
});

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  return runAsPromoterNonStaff(req, async (promoter) => {
  const { id } = await params;
  if (!(await ownsGroup(id, promoter.promoterId))) {
    return NextResponse.json({ error: 'NOT_FOUND' }, { status: 404 });
  }

  const body: unknown = await req.json().catch(() => ({}));
  const parsed = patchSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: 'INVALID_BODY', issues: parsed.error.issues }, { status: 422 });
  }
  const d = parsed.data;

  await db().query(
    `UPDATE event_groups.groups SET
        name = COALESCE($2, name),
        description = COALESCE($3, description),
        cover_image_url = COALESCE($4, cover_image_url),
        brand_color_hex = COALESCE($5, brand_color_hex),
        status = COALESCE($6, status),
        default_currency = COALESCE($7, default_currency),
        default_refund_days = COALESCE($8, default_refund_days),
        default_qr_policy = COALESCE($9, default_qr_policy),
        default_min_age = COALESCE($10, default_min_age),
        updated_at = NOW()
      WHERE id = $1`,
    [
      id, d.name ?? null, d.description ?? null,
      d.coverImageUrl ?? null, d.brandColorHex ?? null,
      d.status ?? null, d.defaultCurrency ?? null,
      d.defaultRefundDays ?? null, d.defaultQrPolicy ?? null,
      d.defaultMinAge ?? null,
    ],
  );

  return NextResponse.json({ ok: true });

  });
}
