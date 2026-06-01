import { NextRequest, NextResponse } from 'next/server';
import { db, runWithServiceContext } from '@/lib/db/rls-pool';


interface OrderRow {
  id: string;
  user_id: string;
  status: string;
}

export async function POST(
  request: NextRequest,
  { params }: { params: { paymentId: string } },
): Promise<Response> {
  return runWithServiceContext(async () => {

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

    // P0 RISK MITIGATION: inkrement pre_review_volume_used pro hard cap tracking
    // (jen pokud promotér ještě nepass review)
    await client.query(
      `UPDATE platform.promoters
          SET pre_review_volume_used_halire = pre_review_volume_used_halire + (
            SELECT COALESCE(total_amount, 0) FROM orders.orders WHERE id = $1
          )
        WHERE id = (
          SELECT e.promoter_id FROM orders.orders o
          JOIN catalog.events e ON e.id = o.event_id
          WHERE o.id = $1
        )
          AND pre_review_passed_at IS NULL`,
      [order.id],
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

    // QR campaign conversion — pokud order má qr_campaign_id (set v checkoutu),
    // inkrement conversion_count + total. Mimo transakci, fire-and-forget.
    void (async () => {
      try {
        await db().query(
          `UPDATE marketing.qr_campaigns
             SET conversion_count = conversion_count + 1,
                 conversion_total_halire = conversion_total_halire + COALESCE(
                   (SELECT total_amount FROM orders.orders WHERE id = $1), 0
                 ),
                 updated_at = now()
           WHERE id = (SELECT qr_campaign_id FROM orders.orders WHERE id = $1)
             AND id IS NOT NULL`,
          [order.id],
        );
      } catch (err) {
        console.error('[mock-gopay] qr_campaign conversion update failed', err);
      }
    })();

    // Real-time sales stream — append do revenue.sales_stream pro SSE dashboard.
    // Mimo transakci — nesmí blokovat odpověď ani rollbacknout order při chybě.
    void (async () => {
      try {
        await db().query(
          `INSERT INTO revenue.sales_stream
             (promoter_id, event_id, order_id, amount_halire, currency, ticket_count, event_title)
           SELECT
             e.promoter_id, o.event_id, o.id, o.total_amount, COALESCE(o.currency, 'CZK'),
             (SELECT COUNT(*)::int FROM tickets.tickets WHERE order_id = o.id),
             e.title
           FROM orders.orders o
           JOIN catalog.events e ON e.id = o.event_id
           WHERE o.id = $1`,
          [order.id],
        );
      } catch (err) {
        console.error('[mock-gopay] sales_stream insert failed', err);
      }
    })();

    // Eventim Pass-style: record buyer + phone purchase counts + bind phone na hot eventy.
    void (async () => {
      try {
        const purchaseCtx = await db().query<{
          event_id: string;
          user_id: string;
          phone: string | null;
          ticket_count: number;
          require_phone_binding: boolean;
        }>(
          `SELECT o.event_id, o.user_id, u.phone,
                  (SELECT COUNT(*)::int FROM tickets.tickets WHERE order_id = o.id) AS ticket_count,
                  COALESCE(e.require_phone_binding, false) AS require_phone_binding
             FROM orders.orders o
             JOIN identity.users u ON u.id = o.user_id
             JOIN catalog.events e ON e.id = o.event_id
            WHERE o.id = $1`,
          [order.id],
        );
        if (purchaseCtx.rows.length === 0) return;
        const ctx = purchaseCtx.rows[0];

        await db().query(
          `INSERT INTO orders.buyer_event_purchases (user_id, event_id, tickets_count)
           VALUES ($1, $2, $3)
           ON CONFLICT (user_id, event_id)
           DO UPDATE SET tickets_count = orders.buyer_event_purchases.tickets_count + EXCLUDED.tickets_count,
                         last_purchase_at = now()`,
          [ctx.user_id, ctx.event_id, ctx.ticket_count],
        );

        if (ctx.phone) {
          await db().query(
            `INSERT INTO orders.phone_event_purchases (phone_e164, event_id, tickets_count)
             VALUES ($1, $2, $3)
             ON CONFLICT (phone_e164, event_id)
             DO UPDATE SET tickets_count = orders.phone_event_purchases.tickets_count + EXCLUDED.tickets_count,
                           last_purchase_at = now()`,
            [ctx.phone, ctx.event_id, ctx.ticket_count],
          );
        }

        // Auto-bind phone na tickets pokud event vyžaduje
        if (ctx.require_phone_binding && ctx.phone) {
          await db().query(
            `UPDATE tickets.tickets
                SET bound_phone_e164 = $1, phone_bound_at = now()
              WHERE order_id = $2 AND bound_phone_e164 IS NULL`,
            [ctx.phone, order.id],
          );
        }
      } catch (err) {
        console.error('[mock-gopay] buyer purchase tracking failed', err);
      }
    })();

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

  });
}
