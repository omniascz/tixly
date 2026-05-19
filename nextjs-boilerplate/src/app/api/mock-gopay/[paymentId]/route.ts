import { NextRequest, NextResponse } from 'next/server';
import { Pool } from 'pg';

let pool: Pool | null = null;
function db(): Pool {
  if (!pool) pool = new Pool({ connectionString: process.env.DATABASE_URL });
  return pool;
}

interface OrderRow {
  id: string;
  user_id: string;
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
      `SELECT id, user_id, status FROM orders.orders
       WHERE gopay_payment_id = $1 LIMIT 1
       FOR UPDATE`,
      [params.paymentId],
    );
    if (orderResult.rows.length === 0) {
      await client.query('ROLLBACK');
      return NextResponse.json(
        { error: 'Order not found for payment' },
        { status: 404 },
      );
    }
    const order = orderResult.rows[0];

    // Idempotency: pokud objednávka už není pending, vrátíme aktuální stav
    if (order.status !== 'pending') {
      await client.query('ROLLBACK');
      return NextResponse.json({ orderId: order.id, status: order.status });
    }

    if (action === 'cancel') {
      await client.query(
        `UPDATE orders.orders
           SET status = 'cancelled', updated_at = NOW()
         WHERE id = $1`,
        [order.id],
      );
      await client.query(
        `INSERT INTO orders.payment_events (order_id, event_type, gopay_status, raw_payload, payment_provider)
         VALUES ($1, 'CANCELED', 'CANCELED', $2::jsonb, 'gopay')`,
        [order.id, JSON.stringify({ paymentId: params.paymentId, source: 'mock' })],
      );
      await client.query('COMMIT');
      return NextResponse.json({ orderId: order.id, status: 'cancelled' });
    }

    // 'pay' (default) — pokud má objednávka payment plan, jen deposit charge → paid_partial
    const hasPlan = await client.query<{ id: string; installments_count: number }>(
      `SELECT opp.id,
              (SELECT COUNT(*)::int FROM orders.payment_installments
               WHERE order_payment_plan_id = opp.id AND status = 'pending') AS installments_count
       FROM orders.order_payment_plans opp
       WHERE opp.order_id = $1 AND opp.status = 'active'`,
      [order.id],
    );
    const partial = hasPlan.rows.length > 0 && hasPlan.rows[0].installments_count > 0;

    await client.query(
      `UPDATE orders.orders
         SET status = $2, paid_at = NOW(), updated_at = NOW(),
             recovered_via_email = (abandoned_email_sent_at IS NOT NULL)
       WHERE id = $1`,
      [order.id, partial ? 'paid_partial' : 'paid'],
    );
    await client.query(
      `INSERT INTO orders.payment_events (order_id, event_type, gopay_status, raw_payload, payment_provider)
       VALUES ($1, $2, $3, $4::jsonb, 'gopay')`,
      [
        order.id,
        partial ? 'PAID_PARTIAL' : 'PAID',
        partial ? 'PAID_PARTIAL' : 'PAID',
        JSON.stringify({ paymentId: params.paymentId, source: 'mock', partial }),
      ],
    );
    await client.query('COMMIT');

    // Fire-and-forget interní webhook (e-mail s lístkem) — mimo transakci
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
    ).catch((err) => console.error('[mock-gopay] internal webhook failed', err));

    return NextResponse.json({ orderId: order.id, status: partial ? 'paid_partial' : 'paid' });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('[mock-gopay]', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  } finally {
    client.release();
  }
}
