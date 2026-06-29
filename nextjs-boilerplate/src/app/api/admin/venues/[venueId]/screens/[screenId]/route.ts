/**
 * PATCH  /api/admin/venues/[venueId]/screens/[screenId]  — editovat sál
 * DELETE /api/admin/venues/[venueId]/screens/[screenId]  — smazat sál
 */

import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db/rls-pool';
import { runAsPromoter } from '@/lib/admin-auth';

export const dynamic = 'force-dynamic';

export async function PATCH(
  req: NextRequest,
  { params }: { params: { venueId: string; screenId: string } },
): Promise<Response> {
  return runAsPromoter(req, async (ctx) => {
    const own = await db().query(
      `SELECT cs.id FROM catalog.cinema_screens cs
       JOIN catalog.venues v ON v.id = cs.venue_id
       WHERE cs.id=$1 AND v.id=$2 AND v.promoter_id=$3 LIMIT 1`,
      [params.screenId, params.venueId, ctx.promoterId],
    );
    if (own.rows.length === 0) return NextResponse.json({ error: 'Not found' }, { status: 404 });

    const b = await req.json() as Record<string, unknown>;
    const ALLOWED = ['name','capacity','screen_type','has_3d','is_accessible','sort_order'];
    const fields: string[] = [];
    const values: unknown[] = [];
    let i = 1;

    for (const key of ALLOWED) {
      if (key in b) { fields.push(`${key}=$${i++}`); values.push(b[key]); }
    }
    if (fields.length === 0) return NextResponse.json({ error: 'Nothing to update' }, { status: 400 });

    values.push(params.screenId);
    const r = await db().query(
      `UPDATE catalog.cinema_screens SET ${fields.join(',')} WHERE id=$${i} RETURNING *`,
      values,
    );
    return NextResponse.json({ screen: r.rows[0] });
  });
}

export async function DELETE(
  req: NextRequest,
  { params }: { params: { venueId: string; screenId: string } },
): Promise<Response> {
  return runAsPromoter(req, async (ctx) => {
    const own = await db().query(
      `SELECT cs.id FROM catalog.cinema_screens cs
       JOIN catalog.venues v ON v.id = cs.venue_id
       WHERE cs.id=$1 AND v.id=$2 AND v.promoter_id=$3 LIMIT 1`,
      [params.screenId, params.venueId, ctx.promoterId],
    );
    if (own.rows.length === 0) return NextResponse.json({ error: 'Not found' }, { status: 404 });

    const inUse = await db().query(
      `SELECT id FROM catalog.events WHERE cinema_screen_id=$1 AND date_start > NOW() LIMIT 1`,
      [params.screenId],
    );
    if (inUse.rows.length > 0) {
      return NextResponse.json(
        { error: 'Sál má budoucí promítání — nejdříve je zrušte' },
        { status: 409 },
      );
    }

    await db().query(`DELETE FROM catalog.cinema_screens WHERE id=$1`, [params.screenId]);
    return NextResponse.json({ ok: true });
  });
}
