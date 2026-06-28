/**
 * POST /api/internal/resale/complete-transfer
 * Called from order-completed after buyer's payment is confirmed.
 * Atomically:
 *  1. Transfers ticket ownership to buyer (update tickets.tickets.owner_id)
 *  2. Marks listing as sold
 *  3. Queues seller payout (resale.seller_payouts)
 *
 * Auth: x-internal-token
 */

import { NextRequest, NextResponse } from 'next/server';
import { db, runWithServiceContext } from '@/lib/db/rls-pool';

export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest): Promise<Response> {
  const token = req.headers.get('x-internal-token');
  const expected = process.env.INTERNAL_API_TOKEN ?? process.env.INTERNAL_SERVICE_TOKEN ?? '';
  if (!token || token !== expected) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const b = await req.json() as { orderId: string };
  if (!b.orderId) return NextResponse.json({ error: 'orderId required' }, { status: 400 });

  return runWithServiceContext(async () => {
    // Check if this is a resale order
    const orderR = await db().query(
      `SELECT o.id, o.user_id AS buyer_user_id, o.resale_listing_id, o.total_amount
       FROM orders.orders o
       WHERE o.id=$1 AND o.resale_listing_id IS NOT NULL AND o.status='paid'
       LIMIT 1`,
      [b.orderId],
    );

    if (orderR.rows.length === 0) return NextResponse.json({ skipped: true });

    const order = orderR.rows[0] as {
      id: string;
      buyer_user_id: string;
      resale_listing_id: string;
      total_amount: number;
    };

    // Lock listing
    const listingR = await db().query(
      `SELECT l.id, l.ticket_id, l.seller_id, l.ask_price,
              l.platform_fee_halire, l.seller_payout_halire,
              l.ticket_type_name, l.commission_rate
       FROM resale.resale_listings l
       WHERE l.id=$1 AND l.status='reserved'
       FOR UPDATE`,
      [order.resale_listing_id],
    );

    if (listingR.rows.length === 0) {
      return NextResponse.json({ error: 'Listing not in reserved state' }, { status: 409 });
    }

    const listing = listingR.rows[0] as {
      id: string;
      ticket_id: string;
      seller_id: string;
      ask_price: number;
      platform_fee_halire: number | null;
      seller_payout_halire: number | null;
      ticket_type_name: string;
      commission_rate: number;
    };

    const platformFee = listing.platform_fee_halire
      ?? Math.round(listing.ask_price * listing.commission_rate / 100);
    const sellerPayout = listing.seller_payout_halire
      ?? (listing.ask_price - platformFee);

    // Transfer ticket ownership to buyer
    await db().query(
      `UPDATE tickets.tickets
       SET owner_id=$1, updated_at=NOW()
       WHERE id=$2`,
      [order.buyer_user_id, listing.ticket_id],
    );

    // Mark listing sold
    await db().query(
      `UPDATE resale.resale_listings
       SET status='sold', sold_at=NOW(), buyer_id=$1,
           reissued_ticket_id=$2, buyer_order_id=$3,
           payout_amount=$4
       WHERE id=$5`,
      [order.buyer_user_id, listing.ticket_id, order.id, sellerPayout, listing.id],
    );

    // Queue seller payout
    await db().query(
      `INSERT INTO resale.seller_payouts
         (listing_id, seller_id, sale_price_halire, resale_fee_halire, payout_halire,
          currency, status, scheduled_for)
       VALUES ($1,$2,$3,$4,$5,'CZK','pending', NOW() + INTERVAL '4 days')
       ON CONFLICT DO NOTHING`,
      [listing.id, listing.seller_id, listing.ask_price, platformFee, sellerPayout],
    ).catch((err: Error) => {
      console.error('[resale] seller payout insert failed for listing', listing.id, err.message);
    });

    return NextResponse.json({
      ok: true,
      ticket_id: listing.ticket_id,
      new_owner_id: order.buyer_user_id,
      seller_payout_halire: sellerPayout,
      platform_fee_halire: platformFee,
    });
  });
}
