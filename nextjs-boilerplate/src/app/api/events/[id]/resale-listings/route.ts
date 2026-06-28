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
  const r = await runWithServiceContext(() =>
    db().query(
      `SELECT
         l.id,
         l.ticket_type_name,
         l.seat_label,
         l.section_label,
         l.original_price_halire,
         l.listing_price_halire,
         l.platform_fee_halire,
         l.seller_payout_halire,
         l.listed_at,
         l.expires_at,
         l.seller_notes,
         ROUND((l.listing_price_halire::numeric / NULLIF(l.original_price_halire,0) - 1) * 100, 1) AS markup_pct
       FROM orders.resale_listings l
       WHERE l.event_id = $1
         AND l.status = 'available'
         AND (l.expires_at IS NULL OR l.expires_at > NOW())
       ORDER BY l.listing_price_halire ASC, l.listed_at ASC
       LIMIT 200`,
      [params.id],
    ),
  );

  // Also return event resale settings
  const eventR = await runWithServiceContext(() =>
    db().query(
      `SELECT resale_enabled, resale_max_price_pct, resale_platform_fee_pct
       FROM catalog.events WHERE id=$1`,
      [params.id],
    ),
  );

  const event = eventR.rows[0] as {
    resale_enabled: boolean;
    resale_max_price_pct: number;
    resale_platform_fee_pct: number;
  } | undefined;

  return NextResponse.json({
    resale_enabled: event?.resale_enabled ?? false,
    max_price_pct: event?.resale_max_price_pct ?? 110,
    platform_fee_pct: event?.resale_platform_fee_pct ?? 15,
    listings: r.rows,
    count: r.rows.length,
  });
}
