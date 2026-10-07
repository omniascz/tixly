/**
 * POST /api/payments/mollie/webhook
 *
 * Mollie payment status notification.
 * Mollie sends POST with body: id=tr_xxxx (just the payment ID).
 *
 * Flow:
 *   1. Read payment ID from body
 *   2. Fetch payment status from Mollie API
 *   3. Find order by gopay_payment_id = tr_xxx
 *   4. Mark paid / failed / expired accordingly
 *   5. Trigger order-completed on payment
 *
 * Mollie retries on non-200. Always respond 200 to stop retries.
 */

import { NextRequest, NextResponse } from 'next/server';
import { db, runWithServiceContext } from '@/lib/db/rls-pool';
import { withWebhookAlert } from '@/lib/ops/webhook-alert';
import { getMollieConfig, getMolliePayment } from '@/lib/payment/mollie';

export const dynamic = 'force-dynamic';

// Kolo 14 / krok 3: selhání webhooku → upozornění provozu (lib/ops/webhook-alert)
export async function POST(req: NextRequest): Promise<Response> {
  return withWebhookAlert('mollie', req, () => handlePost(req));
}

async function handlePost(req: NextRequest): Promise<Response> {
  return runWithServiceContext(async () => {
    // Mollie sends application/x-www-form-urlencoded: id=tr_xxx
    const contentType = req.headers.get('content-type') ?? '';
    let molliePaymentId: string | null = null;

    if (contentType.includes('application/x-www-form-urlencoded')) {
      const text = await req.text();
      const params = new URLSearchParams(text);
      molliePaymentId = params.get('id');
    } else {
      try {
        const json = await req.json() as { id?: string };
        molliePaymentId = json.id ?? null;
      } catch {
        molliePaymentId = null;
      }
    }

    if (!molliePaymentId) {
      return NextResponse.json({ error: 'MISSING_ID' }, { status: 400 });
    }
    // Kolo 2: bez API klíče nelze notifikaci ověřit (Mollie nepodepisuje — autenticita = dotaz na API).
    if (!getMollieConfig().isConfigured) {
      return NextResponse.json({ error: 'WEBHOOK_NOT_CONFIGURED' }, { status: 401 });
    }

    // Fetch authoritative status from Mollie
    let payment;
    try {
      payment = await getMolliePayment(molliePaymentId);
    } catch (err) {
      console.error('[mollie webhook] getMolliePayment failed:', err);
      const httpStatus = (err as { httpStatus?: number }).httpStatus;
      if (httpStatus && httpStatus >= 400 && httpStatus < 500) {
        // platba u Mollie neexistuje / nepatří nám → podvržená notifikace
        return NextResponse.json({ error: 'UNKNOWN_PAYMENT' }, { status: 400 });
      }
      return NextResponse.json({ error: 'MOLLIE_LOOKUP_FAILED' }, { status: 502 });
    }

    const orderId = payment.metadata?.orderId;
    if (!orderId) {
      // Old payment without metadata — ignore
      return NextResponse.json({ ok: true, reason: 'NO_ORDER_ID' });
    }

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
        [molliePaymentId],
      );

      if (orderRes.rows.length === 0) {
        await client.query('ROLLBACK');
        return NextResponse.json({ ok: true, reason: 'ORDER_NOT_FOUND' });
      }

      const order = orderRes.rows[0];

      await client.query(
        `INSERT INTO orders.payment_events
           (order_id, event_type, gopay_status, amount, raw_payload, payment_provider)
         VALUES ($1, $2, $3, $4, $5::jsonb, 'mollie')
           ON CONFLICT DO NOTHING`,
        [
          order.id,
          payment.status === 'paid' ? 'payment_paid' : 'webhook_received',
          payment.status,
          Math.round(parseFloat(payment.amount.value) * 100),
          JSON.stringify({ molliePaymentId, status: payment.status, receivedAt: new Date().toISOString() }),
        ],
      );

      let triggerOrderCompleted = false;

      if (payment.status === 'paid' && order.status === 'pending') {
        const paidMinor = Math.round(parseFloat(payment.amount.value) * 100);
        const amountOk = paidMinor > 0 && paidMinor >= order.total_amount && payment.amount.currency === order.currency;

        if (!amountOk) {
          await client.query('ROLLBACK');
          console.warn(`[mollie webhook] amount mismatch order=${order.id}`);
          return NextResponse.json({ error: 'AMOUNT_MISMATCH' }, { status: 409 });
        }

        const upd = await client.query<{ id: string }>(
          `UPDATE orders.orders
           SET status = 'paid', paid_at = NOW(), updated_at = NOW(),
               payment_provider = 'mollie'
           WHERE id = $1 AND status = 'pending'
           RETURNING id`,
          [order.id],
        );
        triggerOrderCompleted = upd.rows.length > 0;
      } else if (payment.status === 'failed' || payment.status === 'canceled' || payment.status === 'expired') {
        if (order.status === 'pending') {
          await client.query(
            `UPDATE orders.orders SET status = $2, updated_at = NOW() WHERE id = $1 AND status = 'pending'`,
            [order.id, payment.status === 'expired' ? 'expired' : 'cancelled'],
          );
        }
      }

      await client.query('COMMIT');

      if (triggerOrderCompleted) {
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
            console.error('[mollie webhook] order-completed trigger failed:', err);
          }
        })();
      }

      return NextResponse.json({ ok: true, orderId: order.id, mollieStatus: payment.status });
    } catch (err) {
      await client.query('ROLLBACK');
      console.error('[mollie webhook] processing failed:', err);
      return NextResponse.json({ error: 'INTERNAL' }, { status: 500 });
    } finally {
      client.release();
    }
  });
}
