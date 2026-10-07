/**
 * GET /api/checkout/pay-by-link/[orderId]?token=<hmac>
 *
 * Verifikuje HMAC token a vrátí detail phone order pro buyer platební stránku.
 * Token je jednosměrný — buyer vidí detail, ale nemůže ho zfalšovat.
 *
 * Auth: veřejné (token=HMAC je dostatečné)
 */

import { NextRequest, NextResponse } from 'next/server';
import { db, runWithServiceContext } from '@/lib/db/rls-pool';
import { createHmac } from 'crypto';
import { timingSafeEqual } from 'crypto';

function verifyToken(orderId: string, token: string): boolean {
  const secret = process.env.INTERNAL_SERVICE_TOKEN ?? 'dev-secret';
  const [nonce, hmac] = token.split('.');
  if (!nonce || !hmac) return false;
  const expected = createHmac('sha256', secret)
    .update(`${orderId}:${nonce}`)
    .digest('hex');
  try {
    const a = Buffer.from(hmac, 'hex');
    const b = Buffer.from(expected, 'hex');
    if (a.length !== b.length) return false;
    return timingSafeEqual(a, b);
  } catch {
    return false;
  }
}

export async function GET(req: NextRequest, props: { params: Promise<{ orderId: string }> }): Promise<Response> {
  const params = await props.params;
  const { orderId } = params;
  const token = req.nextUrl.searchParams.get('token') ?? '';

  if (!/^[0-9a-f-]{36}$/i.test(orderId)) {
    return NextResponse.json({ error: 'INVALID_ORDER_ID' }, { status: 400 });
  }

  if (!verifyToken(orderId, token)) {
    return NextResponse.json({ error: 'INVALID_TOKEN' }, { status: 403 });
  }

  return runWithServiceContext(async () => {
    const r = await db().query<{
      id: string;
      customer_name: string;
      customer_email: string | null;
      quantity: number;
      total_amount: number;
      status: string;
      pay_link_expires_at: string;
      order_id: string | null;
      event_title: string | null;
      event_date: string | null;
      venue_name: string | null;
      ticket_type_name: string | null;
    }>(
      `SELECT
         po.id,
         po.customer_name,
         po.customer_email,
         po.quantity,
         po.total_amount,
         po.status,
         po.pay_link_expires_at,
         po.order_id,
         e.title AS event_title,
         e.start_at AS event_date,
         v.name AS venue_name,
         tt.name AS ticket_type_name
       FROM orders.phone_orders po
       LEFT JOIN catalog.events e ON e.id = po.event_id
       LEFT JOIN catalog.venues v ON v.id = e.venue_id
       LEFT JOIN catalog.ticket_types tt ON tt.id = po.ticket_type_id
       WHERE po.id = $1
       LIMIT 1`,
      [orderId],
    );

    if (r.rows.length === 0) {
      return NextResponse.json({ error: 'NOT_FOUND' }, { status: 404 });
    }

    const order = r.rows[0];
    const expiresAt = new Date(order.pay_link_expires_at);
    if (expiresAt < new Date()) {
      return NextResponse.json({ error: 'LINK_EXPIRED' }, { status: 410 });
    }

    if (order.status === 'paid') {
      return NextResponse.json({ error: 'ALREADY_PAID', orderId: order.order_id }, { status: 409 });
    }
    if (order.status === 'cancelled' || order.status === 'expired') {
      return NextResponse.json({ error: 'ORDER_CANCELLED' }, { status: 410 });
    }

    return NextResponse.json({
      phoneOrderId: order.id,
      customerName: order.customer_name,
      customerEmail: order.customer_email,
      quantity: order.quantity,
      totalAmount: order.total_amount,
      expiresAt: order.pay_link_expires_at,
      eventTitle: order.event_title,
      eventDate: order.event_date,
      venueName: order.venue_name,
      ticketTypeName: order.ticket_type_name,
      // Buyer UI needs these to proceed to checkout
      token,
    });
  });
}
