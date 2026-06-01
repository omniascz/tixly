/**
 * POST   /api/platform/admin/events/[id]/feature — označit akci jako "Tip redakce"
 * DELETE /api/platform/admin/events/[id]/feature — odebrat z featured
 *
 * Auth: platform admin only (z `requirePlatformAdmin`).
 *
 * Body POST: { order?: number, until?: ISO date, blurb?: string }
 * Body DELETE: žádné
 */
import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db/rls-pool';
import { runAsPlatformAdmin } from '@/lib/platform-auth';
import { z } from 'zod';


const featureSchema = z.object({
  order: z.number().int().min(0).max(1000).optional(),
  until: z.string().datetime().optional(),
  blurb: z.string().max(500).optional(),
});

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  return runAsPlatformAdmin(req, async (admin) => {
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) {
    return NextResponse.json({ error: 'INVALID_ID' }, { status: 400 });
  }

  const body: unknown = await req.json().catch(() => ({}));
  const parsed = featureSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: 'INVALID_BODY', issues: parsed.error.issues }, { status: 422 });
  }

  const r = await db().query<{ id: string }>(
    `UPDATE catalog.events
        SET editorial_featured = true,
            editorial_featured_at = NOW(),
            editorial_featured_by = $2,
            editorial_order = COALESCE($3, editorial_order),
            editorial_until = COALESCE($4::timestamptz, editorial_until),
            editorial_blurb = COALESCE($5, editorial_blurb)
      WHERE id = $1 AND status = 'published'
      RETURNING id`,
    [id, admin.userId, parsed.data.order ?? null, parsed.data.until ?? null, parsed.data.blurb ?? null],
  );

  if (r.rows.length === 0) {
    return NextResponse.json({ error: 'NOT_FOUND_OR_NOT_PUBLISHED' }, { status: 404 });
  }

  return NextResponse.json({ ok: true, id: r.rows[0].id });

  });
}

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  return runAsPlatformAdmin(req, async (_admin) => {
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) {
    return NextResponse.json({ error: 'INVALID_ID' }, { status: 400 });
  }

  await db().query(
    `UPDATE catalog.events
        SET editorial_featured = false,
            editorial_featured_at = NULL,
            editorial_featured_by = NULL,
            editorial_until = NULL,
            editorial_order = 0,
            editorial_blurb = NULL
      WHERE id = $1`,
    [id],
  );

  return NextResponse.json({ ok: true });

  });
}
