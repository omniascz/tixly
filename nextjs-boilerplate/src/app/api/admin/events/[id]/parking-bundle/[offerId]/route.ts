import { NextRequest, NextResponse } from 'next/server';
import { db, runWithServiceContext } from '@/lib/db/rls-pool';
import { runAsPromoter } from '@/lib/admin-auth';

export const dynamic = 'force-dynamic';

export async function PATCH(
  req: NextRequest,
  props: { params: Promise<{ id: string; offerId: string }> }
): Promise<Response> {
  const params = await props.params;
  return runAsPromoter(req, async (ctx) => {
    const own = await runWithServiceContext(() =>
      db().query(
        `SELECT 1 FROM catalog.parking_offers p
         JOIN catalog.events e ON e.id = p.event_id
         WHERE p.id=$1 AND e.promoter_id=$2 LIMIT 1`,
        [params.offerId, ctx.promoterId],
      ),
    );
    if (own.rows.length === 0) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

    const b = await req.json() as Record<string, unknown>;
    const allowed = ['name','description','address','lat','lng','distance_meters',
      'vehicle_types','height_limit_cm','price_halire','capacity',
      'access_instructions','booking_deadline','confirmation_prefix','active','sort_order'];
    const fields: string[] = [];
    const values: unknown[] = [];
    let i = 1;
    for (const key of allowed) {
      if (key in b) { fields.push(`${key}=$${i++}`); values.push(b[key]); }
    }
    if (fields.length === 0) return NextResponse.json({ error: 'Nothing to update' }, { status: 400 });
    values.push(params.offerId);
    const r = await runWithServiceContext(() =>
      db().query(
        `UPDATE catalog.parking_offers SET ${fields.join(',')} WHERE id=$${i} RETURNING *`,
        values,
      ),
    );
    return NextResponse.json(r.rows[0]);
  });
}

export async function DELETE(
  req: NextRequest,
  props: { params: Promise<{ id: string; offerId: string }> }
): Promise<Response> {
  const params = await props.params;
  return runAsPromoter(req, async (ctx) => {
    const own = await runWithServiceContext(() =>
      db().query(
        `SELECT 1 FROM catalog.parking_offers p
         JOIN catalog.events e ON e.id = p.event_id
         WHERE p.id=$1 AND e.promoter_id=$2 LIMIT 1`,
        [params.offerId, ctx.promoterId],
      ),
    );
    if (own.rows.length === 0) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    await runWithServiceContext(() =>
      db().query(`DELETE FROM catalog.parking_offers WHERE id=$1`, [params.offerId]),
    );
    return NextResponse.json({ ok: true });
  });
}
