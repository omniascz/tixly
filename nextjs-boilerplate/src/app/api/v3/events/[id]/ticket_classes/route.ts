/**
 * GET /api/v3/events/:id/ticket_classes
 *
 * Eventbrite-style ticket types pro event.
 * Scope: read_events.
 */
import { NextRequest, NextResponse } from 'next/server';
import { db, runWithPromoterContext } from '@/lib/db/rls-pool';
import { requireApiAuth, rateLimitCheck } from '@/lib/oauth/guard';

export async function GET(
  req: NextRequest,
  { params }: { params: { id: string } },
): Promise<Response> {
  const auth = await requireApiAuth(req, 'read_events');
  if (!auth.ok) return auth.response;

  const rl = await rateLimitCheck(auth.ctx, `/api/v3/events/${params.id}/ticket_classes`, 'GET');
  if (!rl.ok) return rl.response;

  if (!auth.ctx.promoterId) return NextResponse.json({ error: 'no_promoter_scope' }, { status: 403 });
  return runWithPromoterContext(auth.ctx.promoterId, async () => {
  // Verify event je accessible
  const e = await db().query<{ promoter_id: string; status: string; currency: string }>(
    `SELECT promoter_id, status, currency FROM catalog.events WHERE id = $1`,
    [params.id],
  );
  if (e.rows.length === 0) return NextResponse.json({ error: 'not_found' }, { status: 404 });
  const event = e.rows[0];
  if (event.promoter_id !== auth.ctx.promoterId && event.status !== 'published') {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  }

  const r = await db().query(
    `SELECT id, name, NULL::text AS description, base_price AS cost, $2::text AS currency,
            total_qty AS quantity_total, remaining_qty AS quantity_remaining,
            CASE WHEN base_price = 0 THEN true ELSE false END AS free,
            COALESCE(is_donation, false) AS donation,
            visibility, NULL::integer AS display_order,
            created_at::text AS created
       FROM catalog.ticket_types
      WHERE event_id = $1
      ORDER BY base_price`,
    [params.id, event.currency],
  );

  return NextResponse.json({
    ticket_classes: r.rows,
    pagination: { object_count: r.rows.length, has_more_items: false },
  });
  });
}
