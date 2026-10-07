/**
 * PATCH  /api/admin/events/[id]/sponsors/[sponsorId]
 * DELETE /api/admin/events/[id]/sponsors/[sponsorId]
 */

import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db/rls-pool';
import { runAsActivePromoter } from '@/lib/admin-auth';

async function ensureOwnership(eventId: string, promoterId: string): Promise<boolean> {
  const r = await db().query(
    `SELECT 1 FROM catalog.events WHERE id = $1 AND promoter_id = $2 LIMIT 1`,
    [eventId, promoterId],
  );
  return r.rows.length > 0;
}

export async function PATCH(
  req: NextRequest,
  props: { params: Promise<{ id: string; sponsorId: string }> }
): Promise<Response> {
  const params = await props.params;
  return runAsActivePromoter(req, async (promoter) => {
    if (!(await ensureOwnership(params.id, promoter.promoterId))) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 });
    }
    const body = (await req.json()) as Record<string, unknown>;
    const res = await db().query(
      `UPDATE catalog.event_sponsors
       SET name          = COALESCE($3, name),
           logo_url      = COALESCE($4, logo_url),
           click_url     = COALESCE($5, click_url),
           tagline       = COALESCE($6, tagline),
           placement     = COALESCE($7, placement),
           active        = COALESCE($8, active),
           display_order = COALESCE($9, display_order)
       WHERE id = $1 AND event_id = $2
       RETURNING *`,
      [
        params.sponsorId,
        params.id,
        typeof body.name === 'string' ? body.name.trim() : null,
        typeof body.logo_url === 'string' ? body.logo_url.trim() : null,
        typeof body.click_url === 'string' ? body.click_url.trim() : null,
        typeof body.tagline === 'string' ? body.tagline.trim() : null,
        typeof body.placement === 'string' ? body.placement : null,
        typeof body.active === 'boolean' ? body.active : null,
        typeof body.display_order === 'number' ? body.display_order : null,
      ],
    );
    if (res.rows.length === 0) {
      return NextResponse.json({ error: 'Nenalezeno' }, { status: 404 });
    }
    return NextResponse.json({ sponsor: res.rows[0] });
  });
}

export async function DELETE(
  req: NextRequest,
  props: { params: Promise<{ id: string; sponsorId: string }> }
): Promise<Response> {
  const params = await props.params;
  return runAsActivePromoter(req, async (promoter) => {
    if (!(await ensureOwnership(params.id, promoter.promoterId))) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 });
    }
    await db().query(
      `DELETE FROM catalog.event_sponsors WHERE id = $1 AND event_id = $2`,
      [params.sponsorId, params.id],
    );
    return new Response(null, { status: 204 });
  });
}
