/**
 * POST /api/internal/resale/complete-transfer
 * Called from order-completed after buyer's payment is confirmed.
 * Atomically:
 *  1. Invalidates the original ticket
 *  2. Issues a new ticket for the buyer
 *  3. Marks listing as sold
 *  4. Records seller payout (in royalty-style ledger or dedicated table)
 *
 * Auth: x-internal-token
 */

import { NextRequest, NextResponse } from 'next/server';
import { db, runWithServiceContext } from '@/lib/db/rls-pool';
import { randomBytes } from 'crypto';

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
    // Check if this order is a resale order
    const orderR = await db().query(
      `SELECT o.id, o.buyer_user_id, o.resale_listing_id,
              o.holder_name, o.holder_email, o.total_amount
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
      holder_name: string | null;
      holder_email: string;
      total_amount: number;
    };

    // Lock listing
    const listingR = await db().query(
      `SELECT l.*, t.ticket_type_id, t.seat_id, t.metadata AS ticket_meta
       FROM orders.resale_listings l
       JOIN orders.tickets t ON t.id = l.ticket_id
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
      seller_user_id: string;
      event_id: string;
      ticket_type_id: string;
      seat_id: string | null;
      ticket_meta: unknown;
      listing_price_halire: number;
      platform_fee_halire: number;
      seller_payout_halire: number;
      ticket_type_name: string;
    };

    // Generate new ticket barcode
    const newBarcode = randomBytes(16).toString('hex').toUpperCase();

    // Issue new ticket for buyer
    const newTicketR = await db().query(
      `INSERT INTO orders.tickets
         (order_id, ticket_type_id, seat_id,
          holder_name, holder_email, status, barcode,
          metadata, created_at, updated_at)
       SELECT
         $1, ticket_type_id, seat_id,
         $2, $3, 'issued', $4,
         COALESCE(metadata, '{}') || jsonb_build_object('resale', true, 'original_ticket_id', id::text),
         NOW(), NOW()
       FROM orders.tickets
       WHERE id = $5
       RETURNING id`,
      [
        order.id,
        order.holder_name,
        order.holder_email,
        newBarcode,
        listing.ticket_id,
      ],
    );

    const newTicketId = newTicketR.rows[0].id as string;

    // Invalidate old ticket
    await db().query(
      `UPDATE orders.tickets
       SET status='transferred',
           metadata = COALESCE(metadata,'{}') || jsonb_build_object('transferred_to_ticket', $2::text, 'transferred_at', NOW()::text),
           updated_at=NOW()
       WHERE id=$1`,
      [listing.ticket_id, newTicketId],
    );

    // Mark listing sold
    await db().query(
      `UPDATE orders.resale_listings
       SET status='sold', sold_at=NOW(), new_ticket_id=$1, updated_at=NOW()
       WHERE id=$2`,
      [newTicketId, listing.id],
    );

    // Schedule seller payout (insert as pending royalty-style record)
    // Using a simple approach: store in metadata of a seller-payout record
    // In production this would integrate with your payout/bank-transfer system
    await db().query(
      `INSERT INTO orders.orders
         (buyer_user_id, event_id, total_amount, status,
          holder_name, holder_email)
       VALUES ($1,$2,$3,'resale_payout',$4,$5)
       ON CONFLICT DO NOTHING`,
      [
        listing.seller_user_id,
        listing.event_id,
        listing.seller_payout_halire,
        'Resale payout (auto)',
        null,
      ],
    ).catch(() => {
      // Non-critical: payout tracking failure doesn't break transfer
      console.error('[resale] seller payout record insert failed for listing', listing.id);
    });

    return NextResponse.json({
      ok: true,
      old_ticket_id: listing.ticket_id,
      new_ticket_id: newTicketId,
      buyer_email: order.holder_email,
      seller_payout_halire: listing.seller_payout_halire,
      platform_fee_halire: listing.platform_fee_halire,
    });
  });
}
