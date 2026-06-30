/**
 * GET/POST /api/mock-crypto/[paymentId]
 *
 * Mock krypto platba (Bitcoin/Ethereum přes Triple-A — AXS parity).
 * Body POST: { action: 'pay' | 'cancel', coin?: 'BTC' | 'ETH' }
 *
 * Stejný completion flow jako mock-wero/mock-gopay: order paid → payment_events
 * → /api/internal/order-completed. Real produkce: Triple-A hosted checkout +
 * webhook potvrzení on-chain transakce (TRIPLEA_API_KEY).
 */
import { NextRequest, NextResponse } from 'next/server';
import { db, runWithServiceContext } from '@/lib/db/rls-pool';
import { mockPaymentBlockedResponse } from '@/lib/payment/mock-guard';

export const dynamic = 'force-dynamic';

interface OrderRow {
  id: string;
  status: string;
}

export async function GET(
  _req: NextRequest,
  { params }: { params: { paymentId: string } },
): Promise<Response> {
  const blocked = mockPaymentBlockedResponse();
  if (blocked) return blocked;
  return runWithServiceContext(async () => {
    const r = await db().query<{
      id: string; total_amount: number; currency: string; status: string;
      event_title: string | null;
    }>(
      `SELECT o.id, o.total_amount, o.currency, o.status, e.title AS event_title
       FROM orders.orders o
       LEFT JOIN catalog.events e ON e.id = o.event_id
       WHERE o.gopay_payment_id = $1
       LIMIT 1`,
      [params.paymentId],
    );
    if (!r.rows[0]) return NextResponse.json({ error: 'Not found' }, { status: 404 });
    const row = r.rows[0];
    return NextResponse.json({
      paymentId: params.paymentId,
      amount: row.total_amount,
      currency: row.currency,
      status: row.status,
      eventTitle: row.event_title,
    });
  });
}

export async function POST(
  request: NextRequest,
  { params }: { params: { paymentId: string } },
): Promise<Response> {
  const blocked = mockPaymentBlockedResponse();
  if (blocked) return blocked;
  return runWithServiceContext(async () => {
    const { action, coin } = (await request.json().catch(() => ({}))) as {
      action?: string; coin?: string;
    };
    const client = await db().connect();
    try {
      await client.query('BEGIN');
      const orderResult = await client.query<OrderRow>(
        `SELECT id, status FROM orders.orders
         WHERE gopay_payment_id = $1 LIMIT 1 FOR UPDATE`,
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
           VALUES ($1, 'CANCELED', 'CANCELED', $2::jsonb, 'crypto')`,
          [order.id, JSON.stringify({ paymentId: params.paymentId, source: 'mock-crypto', coin })],
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
         VALUES ($1, 'PAID', 'PAID', $2::jsonb, 'crypto')`,
        [order.id, JSON.stringify({ paymentId: params.paymentId, source: 'mock-crypto', coin: coin ?? 'BTC' })],
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
          body: JSON.stringify({ orderId: order.id, paymentProvider: 'crypto' }),
        },
      ).catch((err) => console.error('[mock-crypto] internal webhook failed', err));

      return NextResponse.json({ orderId: order.id, status: 'paid', coin: coin ?? 'BTC' });
    } catch (err) {
      await client.query('ROLLBACK');
      console.error('[mock-crypto]', err);
      return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
    } finally {
      client.release();
    }
  });
}
