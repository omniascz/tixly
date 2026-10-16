/**
 * POST /api/payments/przelewy24/webhook
 *
 * Przelewy24 transaction notification (IPN).
 * P24 sends JSON POST when payment status changes.
 *
 * Flow:
 *   1. Verify SHA-384 signature
 *   2. Find order by gopay_payment_id = sessionId (our orderId)
 *   3. Call P24 verify endpoint (server-to-server confirmation)
 *   4. Mark order paid + trigger order-completed
 *
 * P24 expects HTTP 200 on success. On error it retries.
 */

import { NextRequest, NextResponse } from 'next/server';
import { db, runWithServiceContext } from '@/lib/db/rls-pool';
import { withWebhookAlert } from '@/lib/ops/webhook-alert';
import { getP24Config, verifyP24NotificationSign, verifyP24Transaction } from '@/lib/payment/przelewy24';

export const dynamic = 'force-dynamic';

interface P24Notification {
  merchantId: number;
  posId: number;
  sessionId: string;
  amount: number;
  originAmount: number;
  currency: string;
  orderId: number;
  methodId: number;
  statement: string;
  sign: string;
}

// Kolo 14 / krok 3: selhání webhooku → upozornění provozu (lib/ops/webhook-alert)
export async function POST(req: NextRequest): Promise<Response> {
  return withWebhookAlert('przelewy24', req, () => handlePost(req));
}

async function handlePost(req: NextRequest): Promise<Response> {
  return runWithServiceContext(async () => {
    const cfg = getP24Config();
    // Kolo 2: bez CRC klíče nelze podpis ověřit → fail-closed 4xx.
    if (!cfg.crcKey) {
      return NextResponse.json({ error: 'WEBHOOK_NOT_CONFIGURED' }, { status: 401 });
    }

    let body: P24Notification;
    try {
      body = await req.json() as P24Notification;
    } catch {
      return NextResponse.json({ error: 'INVALID_JSON' }, { status: 400 });
    }
    // Kolo 2: neznámý formát (dřív chybějící `sign` shodil handler výjimkou → 500).
    if (!body || typeof body.sessionId !== 'string' || typeof body.sign !== 'string' || typeof body.currency !== 'string'
        || !Number.isFinite(body.orderId) || !Number.isFinite(body.amount)) {
      return NextResponse.json({ error: 'UNKNOWN_EVENT_FORMAT' }, { status: 400 });
    }

    // Verify signature
    const signOk = verifyP24NotificationSign({
      sessionId: body.sessionId,
      orderId: body.orderId,
      amount: body.amount,
      currency: body.currency,
      crcKey: cfg.crcKey,
      receivedSign: body.sign,
    });

    if (!signOk) {
      console.warn('[p24 webhook] invalid signature for sessionId', body.sessionId);
      return NextResponse.json({ error: 'INVALID_SIGNATURE' }, { status: 401 });
    }

    // Lookup order (sessionId = our orderId = gopay_payment_id)
    const client = await db().connect();
    try {
      await client.query('BEGIN');

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
        [body.sessionId],
      );

      if (orderRes.rows.length === 0) {
        await client.query('ROLLBACK');
        return NextResponse.json({ ok: true, reason: 'ORDER_NOT_FOUND' });
      }

      const order = orderRes.rows[0];

      if (order.status !== 'pending') {
        await client.query('ROLLBACK');
        return NextResponse.json({ ok: true, reason: 'ALREADY_PROCESSED', status: order.status });
      }

      // Amount / currency check
      const amountOk = body.amount >= order.total_amount && body.currency === order.currency;
      if (!amountOk) {
        await client.query('ROLLBACK');
        console.warn(`[p24 webhook] amount mismatch order=${order.id} expected=${order.total_amount}${order.currency} got=${body.amount}${body.currency}`);
        return NextResponse.json({ error: 'AMOUNT_MISMATCH' }, { status: 409 });
      }

      // Call P24 verify (mandatory per P24 protocol)
      const verified = await verifyP24Transaction({
        sessionId: body.sessionId,
        orderId: body.orderId,
        amount: body.amount,
        currency: body.currency,
      });

      if (!verified) {
        await client.query('ROLLBACK');
        console.error('[p24 webhook] verify call failed for', body.sessionId);
        return NextResponse.json({ error: 'VERIFY_FAILED' }, { status: 502 });
      }

      // Audit log
      await client.query(
        `INSERT INTO orders.payment_events
           (order_id, event_type, gopay_status, amount, raw_payload, payment_provider)
         VALUES ($1, 'payment_paid', 'PAID', $2, $3::jsonb, 'przelewy24')
           ON CONFLICT DO NOTHING`,
        [order.id, body.amount, JSON.stringify({ ...body, receivedAt: new Date().toISOString() })],
      );

      const upd = await client.query<{ id: string }>(
        `UPDATE orders.orders
         SET status = 'paid', paid_at = NOW(), updated_at = NOW(),
             payment_provider = 'przelewy24'
         WHERE id = $1 AND status = 'pending'
         RETURNING id`,
        [order.id],
      );

      await client.query('COMMIT');

      if (upd.rows.length > 0) {
        void (async () => {
          try {
            const internalToken = process.env.INTERNAL_SERVICE_TOKEN;
            const appUrl = process.env.APP_URL ?? 'http://localhost:3000';
            if (!internalToken) return;
            await fetch(`${appUrl}/api/internal/order-completed`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json', 'x-internal-token': internalToken },
              body: JSON.stringify({ orderId: order.id }),
            });
          } catch (err) {
            console.error('[p24 webhook] order-completed trigger failed:', err);
          }
        })();
      }

      return NextResponse.json({ ok: true, orderId: order.id });
    } catch (err) {
      await client.query('ROLLBACK');
      console.error('[p24 webhook] processing failed:', err);
      return NextResponse.json({ error: 'INTERNAL' }, { status: 500 });
    } finally {
      client.release();
    }
  });
}
