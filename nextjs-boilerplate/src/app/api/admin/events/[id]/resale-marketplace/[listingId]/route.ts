/**
 * DELETE /api/admin/events/[id]/resale-marketplace/[listingId]
 * Admin cancels any active listing (e.g. suspicious activity).
 */

import { NextRequest, NextResponse } from 'next/server';
import { db, runWithServiceContext } from '@/lib/db/rls-pool';
import { runAsPromoter } from '@/lib/admin-auth';

export const dynamic = 'force-dynamic';

export async function DELETE(
  req: NextRequest,
  props: { params: Promise<{ id: string; listingId: string }> }
): Promise<Response> {
  const params = await props.params;
  return runAsPromoter(req, async (ctx) => {
    const evOwn = await runWithServiceContext(() =>
      db().query(`SELECT id FROM catalog.events WHERE id=$1 AND promoter_id=$2 LIMIT 1`, [params.id, ctx.promoterId]),
    );
    if (evOwn.rows.length === 0) return NextResponse.json({ error: 'Event not found' }, { status: 404 });

    return runWithServiceContext(async () => {
      // Verify listing belongs to this event
      const r = await db().query(
        `UPDATE resale.resale_listings l
         SET status='cancelled', cancelled_at=NOW()
         FROM tickets.tickets t
         JOIN orders.orders o ON o.id = t.order_id
         WHERE l.ticket_id = t.id
           AND o.event_id  = $2
           AND l.id        = $1
           AND l.status    = 'active'
         RETURNING l.ticket_id`,
        [params.listingId, params.id],
      );

      if (r.rows.length === 0) {
        return NextResponse.json({ error: 'Listing not found or not cancellable' }, { status: 404 });
      }

      return NextResponse.json({ ok: true });
    });
  });
}
