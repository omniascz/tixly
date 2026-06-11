/**
 * POST /api/mock-przelewy24/[paymentId]
 *
 * Mock Przelewy24 (polský trh, podobně jako mock-gopay/wero).
 * Body: { action: 'pay' | 'cancel' | 'reject' }
 *
 * V produkci nahradit voláním Przelewy24 API:
 *   POST https://secure.przelewy24.pl/api/v1/transaction/register
 *   POST https://secure.przelewy24.pl/api/v1/transaction/verify
 */

import { NextRequest, NextResponse } from 'next/server';
import { db, runWithServiceContext } from '@/lib/db/rls-pool';
import { mockPaymentBlockedResponse } from '@/lib/payment/mock-guard';


interface OrderRow {
  id: string;
  status: string;
}

export async function POST(
  request: NextRequest,
  { params }: { params: { paymentId: string } },
): Promise<Response> {
  const blocked = mockPaymentBlockedResponse();
  if (blocked) return blocked;
  return runWithServiceContext(async () => {

  const { action } = (await request.json().catch(() => ({}))) as { action?: string };
  const client = await db().connect();

  try {
    await client.query('BEGIN');

    const orderResult = await client.query<OrderRow>(
      `SELECT id, status FROM orders.orders
       WHERE gopay_payment_id = $1 LIMIT 1
       FOR UPDATE`,
      [params.paymentId],
    );
    if (orderResult.rows.length === 0) {
      await client.query('ROLLBACK');
      return NextResponse.json({ error: 'Order not found' }, { status: 404 });
    }
    const order = orderResult.rows[0];

    if (order.status !== 'pending') {
      await client.query('ROLLBACK');
      return NextResponse.json({ orderId: order.id, status: order.status });
    }

    if (action === 'cancel' || action === 'reject') {
      await client.query(
        `UPDATE orders.orders SET status = 'cancelled', updated_at = NOW() WHERE id = $1`,
        [order.id],
      );
      await client.query(
        `INSERT INTO orders.payment_events (order_id, event_type, gopay_status, raw_payload, payment_provider)
         VALUES ($1, 'CANCELED', 'CANCELED', $2::jsonb, 'przelewy24')`,
        [order.id, JSON.stringify({ paymentId: params.paymentId, source: 'mock-przelewy24' })],
      );
      await client.query('COMMIT');
      return NextResponse.json({ orderId: order.id, status: 'cancelled' });
    }

    await client.query(
      `UPDATE orders.orders SET status = 'paid', paid_at = NOW(), updated_at = NOW() WHERE id = $1`,
      [order.id],
    );
    await client.query(
      `INSERT INTO orders.payment_events (order_id, event_type, gopay_status, raw_payload, payment_provider)
       VALUES ($1, 'PAID', 'PAID', $2::jsonb, 'przelewy24')`,
      [order.id, JSON.stringify({ paymentId: params.paymentId, source: 'mock-przelewy24' })],
    );
    await client.query('COMMIT');

    void fetch(
      `${process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3000'}/api/internal/order-completed`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-internal-token': process.env.INTERNAL_SERVICE_TOKEN ?? '',
        },
        body: JSON.stringify({ orderId: order.id }),
      },
    ).catch((err) => console.error('[mock-przelewy24] webhook failed', err));

    return NextResponse.json({ orderId: order.id, status: 'paid' });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('[mock-przelewy24]', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  } finally {
    client.release();
  }

  });
}
