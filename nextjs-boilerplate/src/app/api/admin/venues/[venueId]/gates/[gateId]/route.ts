/**
 * PATCH  /api/admin/venues/[venueId]/gates/[gateId] — update
 * DELETE /api/admin/venues/[venueId]/gates/[gateId] — delete
 */
import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { db } from '@/lib/db/rls-pool';
import { runAsActivePromoter } from '@/lib/admin-auth';

const patchSchema = z.object({
  code:         z.string().min(1).max(20).optional(),
  label:        z.string().min(1).max(120).optional(),
  description:  z.string().max(500).nullable().optional(),
  isAccessible: z.boolean().optional(),
  sortOrder:    z.number().int().min(0).optional(),
});

async function ownerCheck(venueId: string, gateId: string, promoterId: string) {
  const r = await db().query(
    `SELECT g.id FROM catalog.venue_gates g
       JOIN catalog.venues v ON v.id = g.venue_id
      WHERE g.id = $1 AND g.venue_id = $2 AND v.promoter_id = $3`,
    [gateId, venueId, promoterId],
  );
  return r.rows[0] ?? null;
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: { venueId: string; gateId: string } },
): Promise<Response> {
  return runAsActivePromoter(req, async (promoter) => {
    if (!await ownerCheck(params.venueId, params.gateId, promoter.promoterId)) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 });
    }

    const body: unknown = await req.json().catch(() => ({}));
    const parsed = patchSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ error: 'INVALID_INPUT' }, { status: 422 });
    }
    const d = parsed.data;

    const sets: string[] = [];
    const vals: unknown[] = [];
    if (d.code         !== undefined) { vals.push(d.code);         sets.push(`code = $${vals.length}`); }
    if (d.label        !== undefined) { vals.push(d.label);        sets.push(`label = $${vals.length}`); }
    if (d.description  !== undefined) { vals.push(d.description);  sets.push(`description = $${vals.length}`); }
    if (d.isAccessible !== undefined) { vals.push(d.isAccessible); sets.push(`is_accessible = $${vals.length}`); }
    if (d.sortOrder    !== undefined) { vals.push(d.sortOrder);    sets.push(`sort_order = $${vals.length}`); }
    if (sets.length === 0) return NextResponse.json({ ok: true });

    vals.push(params.gateId);
    const r = await db().query(
      `UPDATE catalog.venue_gates SET ${sets.join(', ')} WHERE id = $${vals.length} RETURNING *`,
      vals,
    );
    return NextResponse.json({ gate: r.rows[0] });
  });
}

export async function DELETE(
  req: NextRequest,
  { params }: { params: { venueId: string; gateId: string } },
): Promise<Response> {
  return runAsActivePromoter(req, async (promoter) => {
    if (!await ownerCheck(params.venueId, params.gateId, promoter.promoterId)) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 });
    }
    await db().query(`DELETE FROM catalog.venue_gates WHERE id = $1`, [params.gateId]);
    return NextResponse.json({ ok: true });
  });
}
