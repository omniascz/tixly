/**
 * GET /api/payments/gopay/webhook?id=<paymentId>
 *
 * GoPay notification handler. GoPay neposílá JSON body — pouze pingne GET
 * s ?id=<paymentId> a my si musíme stav vyžádat přes getPayment API.
 *
 * Flow:
 *   1. Read query param ?id=
 *   2. Lookup order podle gopay_payment_id
 *   3. GET /payments/payment/{id} → state (PAID / CREATED / CANCELED / ...)
 *   4. Pokud PAID a order je pending: UPDATE status='paid', paid_at=NOW(),
 *      pak trigger /api/internal/order-completed (PDF + email + SMS)
 *   5. Audit log
 *
 * Idempotency: webhook může přijít víckrát (retry). Skip pokud order už paid.
 *
 * Bezpečnost: GoPay nepoužívá HMAC signaturu. Místo toho ověřuje status přímo
 * z jejich API (server-to-server fetch). Útočník by potřeboval znát platný
 * paymentId — bez OAuth tokenu se ke stavu nedostane.
 */

import { NextRequest, NextResponse } from 'next/server';
import { db, runWithServiceContext } from '@/lib/db/rls-pool';
import { getGopayPaymentStatus } from '@/lib/payment/gopay-real';


export const dynamic = 'force-dynamic';

async function handleWebhook(req: NextRequest, source: 'GET' | 'POST'): Promise<Response> {
  const url = new URL(req.url);
  const paymentId = url.searchParams.get('id') ?? url.searchParams.get('paymentId');

  if (!paymentId) {
    return NextResponse.json({ error: 'MISSING_PAYMENT_ID' }, { status: 400 });
  }

  // Volání GoPay API pro ověření stavu (autoritativní zdroj)
  let status;
  try {
    status = await getGopayPaymentStatus(paymentId);
  } catch (err) {
    console.error('[gopay webhook] getPaymentStatus failed:', err);
    return NextResponse.json({ error: 'GOPAY_LOOKUP_FAILED' }, { status: 502 });
  }

  const client = await db().connect();
  try {
    await client.query('BEGIN');

    // Najdi order podle gopay_payment_id
    const orderRes = await client.query<{
      id: string;
      status: string;
      total_amount: number;
      currency: string;
    }>(
      `SELECT id, status, total_amount, currency
       FROM orders.orders
       WHERE gopay_payment_id = $1
       FOR UPDATE`,
      [paymentId],
    );

    if (orderRes.rows.length === 0) {
      await client.query('ROLLBACK');
      // Možná to byl jen ping pro neznámý payment — nevracejme error (GoPay by retry-oval)
      return NextResponse.json({ ok: true, reason: 'ORDER_NOT_FOUND', paymentId });
    }

    const order = orderRes.rows[0];

    // Zápis do orders.payment_events (canonical webhook log + EET audit trail)
    await client.query(
      `INSERT INTO orders.payment_events
         (order_id, event_type, gopay_status, amount, raw_payload, payment_provider)
       VALUES ($1, $2, $3, $4, $5::jsonb, 'gopay')`,
      [
        order.id,
        status.paid ? 'payment_paid' : status.refunded ? 'payment_refunded' : 'webhook_received',
        status.state,
        status.amountHalire,
        JSON.stringify({
          source,
          paymentId,
          state: status.state,
          paid: status.paid,
          refunded: status.refunded,
          rawAmount: status.amountHalire,
          rawCurrency: status.currency,
          receivedAt: new Date().toISOString(),
        }),
      ],
    );

    let triggerOrderCompleted = false;

    if (status.paid && order.status === 'pending') {
      const upd = await client.query<{ id: string }>(
        `UPDATE orders.orders
         SET status = 'paid', paid_at = NOW(), updated_at = NOW(),
             payment_provider = COALESCE(payment_provider, 'gopay')
         WHERE id = $1 AND status = 'pending'
         RETURNING id`,
        [order.id],
      );
      triggerOrderCompleted = upd.rows.length > 0;
    } else if (status.refunded && order.status !== 'refunded') {
      await client.query(
        `UPDATE orders.orders
         SET status = 'refunded', updated_at = NOW()
         WHERE id = $1`,
        [order.id],
      );
    } else if (
      (status.state === 'CANCELED' || status.state === 'TIMEOUTED') &&
      order.status === 'pending'
    ) {
      await client.query(
        `UPDATE orders.orders
         SET status = $2, updated_at = NOW()
         WHERE id = $1 AND status = 'pending'`,
        [order.id, status.state === 'TIMEOUTED' ? 'expired' : 'cancelled'],
      );
    }

    await client.query('COMMIT');

    // Fire-and-forget — trigger PDF + email + SMS
    if (triggerOrderCompleted) {
      void (async () => {
        try {
          const internalToken = process.env.INTERNAL_SERVICE_TOKEN;
          const appUrl = process.env.APP_URL ?? 'http://localhost:3000';
          if (!internalToken) {
            console.warn('[gopay webhook] INTERNAL_SERVICE_TOKEN missing — skipping order-completed');
            return;
          }
          await fetch(`${appUrl}/api/internal/order-completed`, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'x-internal-token': internalToken,
            },
            body: JSON.stringify({ orderId: order.id }),
          });
        } catch (err) {
          console.error('[gopay webhook] order-completed trigger failed:', err);
        }
      })();
    }

    return NextResponse.json({
      ok: true,
      orderId: order.id,
      state: status.state,
      newStatus: status.paid ? 'paid' : status.refunded ? 'refunded' : order.status,
    });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('[gopay webhook] processing failed:', err);
    return NextResponse.json({ error: 'INTERNAL' }, { status: 500 });
  } finally {
    client.release();
  }
}

export async function GET(req: NextRequest): Promise<Response> {
  return runWithServiceContext(async () => {

  return handleWebhook(req, 'GET');

  });
}

export async function POST(req: NextRequest): Promise<Response> {
  return runWithServiceContext(async () => {

  return handleWebhook(req, 'POST');

  });
}
