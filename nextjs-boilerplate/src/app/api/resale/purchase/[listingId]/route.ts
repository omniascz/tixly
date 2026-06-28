/**
 * POST /api/resale/purchase/[listingId]
 * Buyer initiates resale purchase → reserves listing → creates pending order → returns payment URL.
 * Ticket transfer completes in /api/internal/resale/complete-transfer after payment.
 */

import { NextRequest, NextResponse } from 'next/server';
import { db, runWithServiceContext } from '@/lib/db/rls-pool';
import { runAsUser } from '@/lib/auth';

export const dynamic = 'force-dynamic';

export async function POST(
  req: NextRequest,
  { params }: { params: { listingId: string } },
): Promise<Response> {
  return runAsUser(req, async (userId) => {
    const b = await req.json() as {
      payment_method?: string;
      holder_name?: string;
      holder_email?: string;
      return_url?: string;
    };

    return runWithServiceContext(async () => {
      // Lock listing atomically
      const listingR = await db().query(
        `SELECT l.*, e.title AS event_title
         FROM orders.resale_listings l
         JOIN catalog.events e ON e.id = l.event_id
         WHERE l.id=$1 AND l.status='available'
           AND (l.expires_at IS NULL OR l.expires_at > NOW())
         FOR UPDATE SKIP LOCKED`,
        [params.listingId],
      );

      if (listingR.rows.length === 0) {
        return NextResponse.json({ error: 'Listing not available' }, { status: 409 });
      }

      const listing = listingR.rows[0] as {
        id: string;
        ticket_id: string;
        seller_user_id: string;
        event_id: string;
        event_title: string;
        ticket_type_name: string;
        seat_label: string | null;
        listing_price_halire: number;
        platform_fee_halire: number;
        seller_payout_halire: number;
      };

      if (listing.seller_user_id === userId) {
        return NextResponse.json({ error: 'You cannot buy your own listing' }, { status: 409 });
      }

      const reservedUntil = new Date(Date.now() + 15 * 60 * 1000);

      // Create pending order
      const orderR = await db().query(
        `INSERT INTO orders.orders
           (buyer_user_id, event_id, total_amount, status, resale_listing_id)
         VALUES ($1,$2,$3,'pending',$4)
         RETURNING id`,
        [userId, listing.event_id, listing.listing_price_halire, params.listingId],
      );

      const orderId = orderR.rows[0].id as string;

      // Reserve listing
      await db().query(
        `UPDATE orders.resale_listings
         SET status='reserved', reserved_until=$1, buyer_user_id=$2, buyer_order_id=$3, updated_at=NOW()
         WHERE id=$4`,
        [reservedUntil.toISOString(), userId, orderId, params.listingId],
      );

      const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3000';

      // Try to initiate payment via existing checkout pay endpoint
      let paymentUrl: string | null = null;
      try {
        const payR = await fetch(`${appUrl}/api/checkout/pay`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            cookie: req.headers.get('cookie') ?? '',
          },
          body: JSON.stringify({
            orderId,
            amount: listing.listing_price_halire,
            currency: 'CZK',
            description: `Resale: ${listing.event_title} — ${listing.ticket_type_name}${listing.seat_label ? ` (${listing.seat_label})` : ''}`,
            paymentMethod: b.payment_method ?? 'gopay',
            returnUrl: b.return_url ?? `${appUrl}/order/${orderId}/confirmation`,
          }),
        });
        if (payR.ok) {
          const pd = await payR.json() as { payment_url?: string; gateway_url?: string };
          paymentUrl = pd.payment_url ?? pd.gateway_url ?? null;
        }
      } catch {
        // payment init failed — still return order ID, UI can retry
      }

      return NextResponse.json({
        order_id: orderId,
        listing_id: params.listingId,
        reserved_until: reservedUntil.toISOString(),
        payment_url: paymentUrl,
        amount_halire: listing.listing_price_halire,
      }, { status: 201 });
    });
  });
}
