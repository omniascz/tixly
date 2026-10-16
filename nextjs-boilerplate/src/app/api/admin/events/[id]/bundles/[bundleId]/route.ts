/**
 * PATCH  /api/admin/events/[id]/bundles/[bundleId] — toggle active / update
 * DELETE /api/admin/events/[id]/bundles/[bundleId] — smazat bundle
 */

import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db/rls-pool';
import { runAsActivePromoter } from '@/lib/admin-auth';
import { z } from 'zod';

async function ensureOwnership(
  eventId: string,
  bundleId: string,
  promoterId: string,
): Promise<boolean> {
  const r = await db().query(
    `SELECT 1 FROM catalog.event_bundles b
     JOIN catalog.events e ON e.id = b.event_id
     WHERE b.id = $1 AND b.event_id = $2 AND e.promoter_id = $3 LIMIT 1`,
    [bundleId, eventId, promoterId],
  );
  return r.rows.length > 0;
}

const patchSchema = z.object({
  active: z.boolean().optional(),
  name: z.string().min(1).max(200).optional(),
  description: z.string().max(1000).nullable().optional(),
  discountPct: z.number().int().min(0).max(100).optional(),
});

export async function PATCH(
  req: NextRequest,
  props: { params: Promise<{ id: string; bundleId: string }> }
): Promise<Response> {
  const params = await props.params;
  return runAsActivePromoter(req, async (promoter) => {
    if (!(await ensureOwnership(params.id, params.bundleId, promoter.promoterId))) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 });
    }
    const body: unknown = await req.json().catch(() => ({}));
    const parsed = patchSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ error: 'Validation failed', issues: parsed.error.issues }, { status: 422 });
    }
    const d = parsed.data;
    const sets: string[] = [];
    const vals: unknown[] = [];
    let idx = 1;
    if (d.active !== undefined) { sets.push(`active = $${idx++}`); vals.push(d.active); }
    if (d.name !== undefined) { sets.push(`name = $${idx++}`); vals.push(d.name); }
    if (d.description !== undefined) { sets.push(`description = $${idx++}`); vals.push(d.description); }
    if (d.discountPct !== undefined) { sets.push(`discount_pct = $${idx++}`); vals.push(d.discountPct); }
    if (sets.length === 0) return NextResponse.json({ ok: true });
    vals.push(params.bundleId);
    await db().query(
      `UPDATE catalog.event_bundles SET ${sets.join(', ')} WHERE id = $${idx}`,
      vals,
    );
    return NextResponse.json({ ok: true });
  });
}

export async function DELETE(
  req: NextRequest,
  props: { params: Promise<{ id: string; bundleId: string }> }
): Promise<Response> {
  const params = await props.params;
  return runAsActivePromoter(req, async (promoter) => {
    if (!(await ensureOwnership(params.id, params.bundleId, promoter.promoterId))) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 });
    }
    await db().query(`DELETE FROM catalog.event_bundles WHERE id = $1`, [params.bundleId]);
    return NextResponse.json({ ok: true });
  });
}
