/**
 * PATCH /api/admin/tracking-pixels/[id]  — toggle active / rename
 * DELETE /api/admin/tracking-pixels/[id] — remove pixel
 */
import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db/rls-pool';
import { runAsPromoterNonStaff } from '@/lib/admin-auth';

export const dynamic = 'force-dynamic';

export async function PATCH(
  req: NextRequest,
  { params }: { params: { id: string } },
): Promise<Response> {
  return runAsPromoterNonStaff(req, async (ctx) => {
    const own = await db().query(
      `SELECT id FROM marketing.tracking_pixels WHERE id=$1 AND promoter_id=$2`,
      [params.id, ctx.promoterId],
    );
    if (own.rows.length === 0) return NextResponse.json({ error: 'Not found' }, { status: 404 });

    const b = await req.json() as { isActive?: boolean; pixelName?: string };
    const fields: string[] = [];
    const vals: unknown[] = [];
    let i = 1;
    if (typeof b.isActive === 'boolean') { fields.push(`is_active=$${i++}`); vals.push(b.isActive); }
    if (typeof b.pixelName === 'string')  { fields.push(`pixel_name=$${i++}`); vals.push(b.pixelName.slice(0, 80)); }
    if (fields.length === 0) return NextResponse.json({ error: 'Nothing to update' }, { status: 400 });

    vals.push(params.id);
    const r = await db().query(
      `UPDATE marketing.tracking_pixels SET ${fields.join(',')} WHERE id=$${i} RETURNING *`,
      vals,
    );
    return NextResponse.json({ pixel: r.rows[0] });
  });
}

export async function DELETE(
  req: NextRequest,
  { params }: { params: { id: string } },
): Promise<Response> {
  return runAsPromoterNonStaff(req, async (ctx) => {
    const own = await db().query(
      `SELECT id FROM marketing.tracking_pixels WHERE id=$1 AND promoter_id=$2`,
      [params.id, ctx.promoterId],
    );
    if (own.rows.length === 0) return NextResponse.json({ error: 'Not found' }, { status: 404 });

    await db().query(`DELETE FROM marketing.tracking_pixels WHERE id=$1`, [params.id]);
    return NextResponse.json({ ok: true });
  });
}
