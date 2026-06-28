/**
 * GET /api/events/[id]/resale-listings
 * Public endpoint — available listings for an event.
 * No auth required. Sorted by price ASC.
 */

import { NextRequest, NextResponse } from 'next/server';
import { db, runWithServiceContext } from '@/lib/db/rls-pool';

export const dynamic = 'force-dynamic';

export async function GET(
  _req: NextRequest,
  { params }: { params: { id: string } },
): Promise<Response> {
  const [listingsR, eventR] = await Promise.all([
    runWithServiceContext(() =>
      db().query(
        `SELECT
           l.id,
           l.ticket_type_name,
           l.seat_label,
           l.section_label,
           l.original_price                                                    AS original_price_halire,
           l.ask_price                                                         AS listing_price_halire,
           l.platform_fee_halire,
           l.seller_payout_halire,
           l.listed_at,
           l.expires_at,
           l.seller_notes,
           ROUND(
             (l.ask_price::numeric / NULLIF(l.original_price,0) - 1) * 100, 1
           )                                                                   AS markup_pct
         FROM resale.resale_listings l
         JOIN tickets.tickets t ON t.id  = l.ticket_id
         JOIN orders.orders   o ON o.id  = t.order_id
         WHERE o.event_id = $1
           AND l.status   = 'active'
           AND (l.expires_at IS NULL OR l.expires_at > NOW())
         ORDER BY l.ask_price ASC, l.listed_at ASC
         LIMIT 200`,
        [params.id],
      ),
    ),
    runWithServiceContext(() =>
      db().query(
        `SELECT resale_enabled, resale_max_price_pct, resale_platform_fee_pct, fansale_mode
         FROM catalog.events WHERE id=$1`,
        [params.id],
      ),
    ),
  ]);

  const event = eventR.rows[0] as {
    resale_enabled: boolean;
    resale_max_price_pct: number;
    resale_platform_fee_pct: number;
    fansale_mode: boolean;
  } | undefined;

  return NextResponse.json({
    resale_enabled: event?.resale_enabled ?? false,
    max_price_pct: event?.fansale_mode ? 100 : (event?.resale_max_price_pct ?? 110),
    platform_fee_pct: event?.resale_platform_fee_pct ?? 15,
    fansale_mode: event?.fansale_mode ?? false,
    listings: listingsR.rows,
    count: listingsR.rows.length,
  });
}
