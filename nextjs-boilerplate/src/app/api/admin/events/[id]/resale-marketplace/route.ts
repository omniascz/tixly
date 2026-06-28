/**
 * GET  /api/admin/events/[id]/resale-marketplace — list all listings + stats
 * PATCH /api/admin/events/[id]/resale-marketplace — update event resale settings
 */

import { NextRequest, NextResponse } from 'next/server';
import { db, runWithServiceContext } from '@/lib/db/rls-pool';
import { runAsPromoter } from '@/lib/admin-auth';

export const dynamic = 'force-dynamic';

export async function GET(
  req: NextRequest,
  { params }: { params: { id: string } },
): Promise<Response> {
  return runAsPromoter(req, async (ctx) => {
    const evOwn = await runWithServiceContext(() =>
      db().query(`SELECT id FROM catalog.events WHERE id=$1 AND promoter_id=$2 LIMIT 1`, [params.id, ctx.promoterId]),
    );
    if (evOwn.rows.length === 0) return NextResponse.json({ error: 'Event not found' }, { status: 404 });

    const [settingsR, listingsR, statsR] = await Promise.all([
      runWithServiceContext(() =>
        db().query(
          `SELECT resale_enabled, resale_max_price_pct, resale_platform_fee_pct,
                  resale_cooling_hours, resale_allow_below_face
           FROM catalog.events WHERE id=$1`,
          [params.id],
        ),
      ),
      runWithServiceContext(() =>
        db().query(
          `SELECT l.*,
                  su.email AS seller_email,
                  bu.email AS buyer_email
           FROM resale.resale_listings l
           JOIN tickets.tickets  t  ON t.id  = l.ticket_id
           JOIN orders.orders    o  ON o.id  = t.order_id
           LEFT JOIN identity.users su ON su.id = l.seller_id
           LEFT JOIN identity.users bu ON bu.id = l.buyer_id
           WHERE o.event_id = $1
           ORDER BY l.listed_at DESC
           LIMIT 500`,
          [params.id],
        ),
      ),
      runWithServiceContext(() =>
        db().query(
          `SELECT
             COUNT(*)                                       FILTER (WHERE l.status='active')     AS active_count,
             COUNT(*)                                       FILTER (WHERE l.status='sold')       AS sold_count,
             COUNT(*)                                       FILTER (WHERE l.status='cancelled')  AS cancelled_count,
             COALESCE(SUM(l.ask_price)     FILTER (WHERE l.status='sold'), 0)::int              AS total_resale_volume,
             COALESCE(SUM(l.platform_fee_halire) FILTER (WHERE l.status='sold'), 0)::int        AS total_platform_fees,
             COALESCE(AVG(
               ROUND((l.ask_price::numeric / NULLIF(l.original_price,0) - 1) * 100, 1)
             ) FILTER (WHERE l.status='sold'), 0)::numeric(6,2)                                 AS avg_markup_pct
           FROM resale.resale_listings l
           JOIN tickets.tickets t ON t.id  = l.ticket_id
           JOIN orders.orders   o ON o.id  = t.order_id
           WHERE o.event_id = $1`,
          [params.id],
        ),
      ),
    ]);

    return NextResponse.json({
      settings: settingsR.rows[0] ?? {},
      listings: listingsR.rows,
      stats: statsR.rows[0] ?? {},
    });
  });
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: { id: string } },
): Promise<Response> {
  return runAsPromoter(req, async (ctx) => {
    const evOwn = await runWithServiceContext(() =>
      db().query(`SELECT id FROM catalog.events WHERE id=$1 AND promoter_id=$2 LIMIT 1`, [params.id, ctx.promoterId]),
    );
    if (evOwn.rows.length === 0) return NextResponse.json({ error: 'Event not found' }, { status: 404 });

    const b = await req.json() as {
      resale_enabled?: boolean;
      resale_max_price_pct?: number;
      resale_platform_fee_pct?: number;
      resale_cooling_hours?: number;
      resale_allow_below_face?: boolean;
    };

    const fields: string[] = [];
    const values: unknown[] = [];
    let i = 1;

    if (b.resale_enabled          !== undefined) { fields.push(`resale_enabled=$${i++}`);           values.push(b.resale_enabled); }
    if (b.resale_max_price_pct    !== undefined) { fields.push(`resale_max_price_pct=$${i++}`);     values.push(b.resale_max_price_pct); }
    if (b.resale_platform_fee_pct !== undefined) { fields.push(`resale_platform_fee_pct=$${i++}`);  values.push(b.resale_platform_fee_pct); }
    if (b.resale_cooling_hours    !== undefined) { fields.push(`resale_cooling_hours=$${i++}`);     values.push(b.resale_cooling_hours); }
    if (b.resale_allow_below_face !== undefined) { fields.push(`resale_allow_below_face=$${i++}`);  values.push(b.resale_allow_below_face); }

    if (fields.length === 0) return NextResponse.json({ error: 'Nothing to update' }, { status: 400 });

    values.push(params.id);
    await runWithServiceContext(() =>
      db().query(`UPDATE catalog.events SET ${fields.join(',')} WHERE id=$${i}`, values),
    );

    return NextResponse.json({ ok: true });
  });
}
