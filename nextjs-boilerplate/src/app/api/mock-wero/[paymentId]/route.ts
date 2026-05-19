/**
 * POST /api/mock-wero/[paymentId]
 *
 * Mock Wero (European A2A — account-to-account, EPI initiative).
 * Body: { action: 'pay' | 'cancel' | 'reject' }
 *
 * Stejné API jako mock-gopay, ale provider='wero'. Tipycké Wero flow:
 *   - kupec zadá IBAN nebo přesměruje na bankovní app
 *   - banka iniciuje SEPA Instant převod (∼10 s)
 *   - merchant dostane notifikaci 'paid'
 *
 * Pro demo: instant 'paid' jako mock-gopay.
 */

import { NextRequest, NextResponse } from 'next/server';
import { Pool } from 'pg';

let pool: Pool | null = null;
function db(): Pool {
  if (!pool) pool = new Pool({ connectionString: process.env.DATABASE_URL });
  return pool;
}

interface OrderRow {
  id: string;
  status: string;
}

export async function POST(
  request: NextRequest,
  { params }: { params: { paymentId: string } },
): Promise<Response> {
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

    // Idempotency
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
         VALUES ($1, 'CANCELED', 'CANCELED', $2::jsonb, 'wero')`,
        [order.id, JSON.stringify({ paymentId: params.paymentId, source: 'mock-wero' })],
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
       VALUES ($1, 'PAID', 'PAID', $2::jsonb, 'wero')`,
      [order.id, JSON.stringify({ paymentId: params.paymentId, source: 'mock-wero' })],
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
    ).catch((err) => console.error('[mock-wero] internal webhook failed', err));

    return NextResponse.json({ orderId: order.id, status: 'paid' });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('[mock-wero]', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  } finally {
    client.release();
  }
}
