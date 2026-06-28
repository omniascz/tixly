/**
 * DELETE /api/admin/events/[id]/resale-marketplace/[listingId]
 * Admin cancels any available listing (e.g. suspicious activity).
 */

import { NextRequest, NextResponse } from 'next/server';
import { db, runWithServiceContext } from '@/lib/db/rls-pool';
import { runAsPromoter } from '@/lib/admin-auth';

export const dynamic = 'force-dynamic';

export async function DELETE(
  req: NextRequest,
  { params }: { params: { id: string; listingId: string } },
): Promise<Response> {
  return runAsPromoter(req, async (ctx) => {
    const evOwn = await runWithServiceContext(() =>
      db().query(`SELECT id FROM catalog.events WHERE id=$1 AND promoter_id=$2 LIMIT 1`, [params.id, ctx.promoterId]),
    );
    if (evOwn.rows.length === 0) return NextResponse.json({ error: 'Event not found' }, { status: 404 });

    return runWithServiceContext(async () => {
      const r = await db().query(
        `UPDATE orders.resale_listings
         SET status='cancelled', cancelled_at=NOW(), updated_at=NOW()
         WHERE id=$1 AND event_id=$2 AND status='available'
         RETURNING ticket_id`,
        [params.listingId, params.id],
      );

      if (r.rows.length === 0) {
        return NextResponse.json({ error: 'Listing not found or not cancellable' }, { status: 404 });
      }

      // Restore ticket to issued
      await db().query(
        `UPDATE orders.tickets SET status='issued', updated_at=NOW() WHERE id=$1`,
        [r.rows[0].ticket_id as string],
      );

      return NextResponse.json({ ok: true });
    });
  });
}
