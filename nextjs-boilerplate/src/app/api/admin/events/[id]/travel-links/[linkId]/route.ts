/**
 * PATCH  /api/admin/events/[id]/travel-links/[linkId]
 * DELETE /api/admin/events/[id]/travel-links/[linkId]
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
  props: { params: Promise<{ id: string; linkId: string }> }
): Promise<Response> {
  const params = await props.params;
  return runAsActivePromoter(req, async (promoter) => {
    if (!(await ensureOwnership(params.id, promoter.promoterId))) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 });
    }
    const body = (await req.json()) as Record<string, unknown>;
    const res = await db().query(
      `UPDATE catalog.event_travel_links
       SET label          = COALESCE($3, label),
           category       = COALESCE($4, category),
           partner_name   = COALESCE($5, partner_name),
           url            = COALESCE($6, url),
           affiliate_note = COALESCE($7, affiliate_note),
           active         = COALESCE($8, active),
           display_order  = COALESCE($9, display_order)
       WHERE id = $1 AND event_id = $2
       RETURNING *`,
      [
        params.linkId,
        params.id,
        typeof body.label === 'string' ? body.label.trim() : null,
        typeof body.category === 'string' ? body.category : null,
        typeof body.partner_name === 'string' ? body.partner_name.trim() : null,
        typeof body.url === 'string' ? body.url.trim() : null,
        typeof body.affiliate_note === 'string' ? body.affiliate_note.trim() : null,
        typeof body.active === 'boolean' ? body.active : null,
        typeof body.display_order === 'number' ? body.display_order : null,
      ],
    );
    if (res.rows.length === 0) {
      return NextResponse.json({ error: 'Nenalezeno' }, { status: 404 });
    }
    return NextResponse.json({ link: res.rows[0] });
  });
}

export async function DELETE(
  req: NextRequest,
  props: { params: Promise<{ id: string; linkId: string }> }
): Promise<Response> {
  const params = await props.params;
  return runAsActivePromoter(req, async (promoter) => {
    if (!(await ensureOwnership(params.id, promoter.promoterId))) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 });
    }
    await db().query(
      `DELETE FROM catalog.event_travel_links WHERE id = $1 AND event_id = $2`,
      [params.linkId, params.id],
    );
    return new Response(null, { status: 204 });
  });
}
