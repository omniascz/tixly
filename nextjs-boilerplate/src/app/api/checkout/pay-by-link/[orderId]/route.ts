/**
 * GET /api/checkout/pay-by-link/[orderId]
 * Validates that a phone order's payment link token matches and returns order details.
 * The [orderId] param is the HMAC token embedded in the link.
 */
import { NextResponse } from 'next/server';
import { db, runWithServiceContext } from '@/lib/db/rls-pool';

export async function GET(
  _req: Request,
  { params }: { params: { orderId: string } },
): Promise<Response> {
  const token = params.orderId;
  if (!token || token.length < 10) {
    return NextResponse.json({ error: 'INVALID_TOKEN' }, { status: 400 });
  }

  return runWithServiceContext(async () => {
    const res = await db().query<{
      id: string;
      buyer_email: string;
      buyer_name: string | null;
      total_amount: number;
      currency: string;
      status: string;
      phone_payment_expires_at: string | null;
      event_id: string;
      event_name: string | null;
    }>(
      `SELECT o.id, o.buyer_email, o.buyer_name, o.total_amount, o.currency, o.status,
              o.phone_payment_expires_at::text,
              o.event_id, e.name AS event_name
         FROM orders.orders o
         LEFT JOIN catalog.events e ON e.id = o.event_id
        WHERE o.phone_payment_link LIKE $1
          AND o.order_source = 'phone'
          AND o.status = 'pending_payment'
        LIMIT 1`,
      [`%${token}`],
    );

    const order = res.rows[0];
    if (!order) {
      return NextResponse.json({ error: 'ORDER_NOT_FOUND' }, { status: 404 });
    }

    if (order.phone_payment_expires_at && new Date(order.phone_payment_expires_at) < new Date()) {
      return NextResponse.json({ error: 'LINK_EXPIRED' }, { status: 410 });
    }

    return NextResponse.json({
      orderId: order.id,
      buyerEmail: order.buyer_email,
      buyerName: order.buyer_name,
      totalAmount: order.total_amount,
      currency: order.currency,
      eventId: order.event_id,
      eventName: order.event_name,
    });
  });
}
