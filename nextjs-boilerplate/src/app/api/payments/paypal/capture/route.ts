/**
 * GET /api/payments/paypal/capture?orderId={tixlyOrderId}&token={paypalOrderId}
 *
 * PayPal return URL handler. Called after buyer approves payment on PayPal.
 * Captures the payment and marks order as paid.
 *
 * PayPal injects `token` = PayPal Order ID into the return URL.
 * `orderId` = our Tixly order UUID (passed as query param when creating PayPal order).
 *
 * On success: redirect to order confirmation page.
 * On failure: redirect back to checkout with error.
 */

import { NextRequest, NextResponse } from 'next/server';
import { db, runWithServiceContext } from '@/lib/db/rls-pool';
import { capturePayPalOrder } from '@/lib/payment/paypal';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest): Promise<Response> {
  return runWithServiceContext(async () => {
    const url = new URL(req.url);
    const tixlyOrderId = url.searchParams.get('orderId');
    const paypalOrderId = url.searchParams.get('token'); // PayPal injects {TOKEN} → ?token=xxx

    const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3000';

    if (!tixlyOrderId || !paypalOrderId) {
      return NextResponse.redirect(`${appUrl}/cs/checkout?paypal_error=missing_params`);
    }

    try {
      const capture = await capturePayPalOrder(paypalOrderId);

      if (!capture.captured) {
        console.warn('[paypal capture] not captured for paypalOrderId', paypalOrderId);
        return NextResponse.redirect(`${appUrl}/cs/checkout?paypal_error=capture_failed&orderId=${tixlyOrderId}`);
      }

      const client = await db().connect();
      try {
        await client.query('BEGIN');

        const orderRes = await client.query<{ id: string; status: string; total_amount: number; currency: string }>(
          `SELECT id, status, total_amount, currency
           FROM orders.orders
           WHERE id = $1
           FOR UPDATE`,
          [tixlyOrderId],
        );

        if (orderRes.rows.length === 0) {
          await client.query('ROLLBACK');
          return NextResponse.redirect(`${appUrl}/cs/checkout?paypal_error=order_not_found`);
        }

        const order = orderRes.rows[0];

        if (order.status !== 'pending') {
          await client.query('ROLLBACK');
          // Already processed (e.g. from webhook) — just redirect to confirmation
          return NextResponse.redirect(`${appUrl}/cs/order-confirmation/${tixlyOrderId}`);
        }

        // Amount verification
        const capturedMinor = Math.round(parseFloat(capture.amountValue) * 100);
        const amountOk = capturedMinor >= order.total_amount && capture.currency === order.currency;
        if (!amountOk) {
          await client.query('ROLLBACK');
          console.warn(`[paypal capture] amount mismatch order=${order.id}`);
          return NextResponse.redirect(`${appUrl}/cs/checkout?paypal_error=amount_mismatch&orderId=${tixlyOrderId}`);
        }

        await client.query(
          `INSERT INTO orders.payment_events
             (order_id, event_type, gopay_status, amount, raw_payload, payment_provider)
           VALUES ($1, 'payment_paid', 'COMPLETED', $2, $3::jsonb, 'paypal')`,
          [
            order.id,
            capturedMinor,
            JSON.stringify({
              paypalOrderId,
              captureId: capture.paypalCaptureId,
              amount: capture.amountValue,
              currency: capture.currency,
              capturedAt: new Date().toISOString(),
            }),
          ],
        );

        await client.query(
          `UPDATE orders.orders
           SET status = 'paid', paid_at = NOW(), updated_at = NOW(),
               payment_provider = 'paypal', gopay_payment_id = $2
           WHERE id = $1 AND status = 'pending'`,
          [order.id, paypalOrderId],
        );

        await client.query('COMMIT');

        // Fire-and-forget order-completed (tickets + email)
        void (async () => {
          try {
            const internalToken = process.env.INTERNAL_SERVICE_TOKEN;
            if (!internalToken) return;
            await fetch(`${appUrl}/api/internal/order-completed`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json', 'x-internal-token': internalToken },
              body: JSON.stringify({ orderId: order.id }),
            });
          } catch (err) {
            console.error('[paypal capture] order-completed trigger failed:', err);
          }
        })();

        client.release();
        return NextResponse.redirect(`${appUrl}/cs/order-confirmation/${tixlyOrderId}`);
      } catch (err) {
        await client.query('ROLLBACK');
        client.release();
        throw err;
      }
    } catch (err) {
      console.error('[paypal capture] failed:', err);
      return NextResponse.redirect(`${appUrl}/cs/checkout?paypal_error=internal&orderId=${tixlyOrderId}`);
    }
  });
}
