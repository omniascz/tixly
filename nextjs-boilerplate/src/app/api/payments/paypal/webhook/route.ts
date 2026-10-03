/**
 * POST /api/payments/paypal/webhook
 *
 * PayPal Webhook event receiver.
 * Handles: PAYMENT.CAPTURE.COMPLETED, PAYMENT.CAPTURE.REFUNDED
 *
 * PayPal dashboard: Webhooks → add endpoint URL, select events.
 * Copy Webhook ID → PAYPAL_WEBHOOK_ID env var.
 *
 * Bezpečnost (kolo 2 — fail-closed):
 *   1. Bez PAYPAL_WEBHOOK_ID / API přístupu → 401, nic se nezmění (dřív se podpis
 *      při chybějícím WEBHOOK_ID vůbec neověřoval a událost se zpracovala).
 *   2. Podpis ověřuje PayPal REST API (verify-webhook-signature); neplatný → 401.
 *   3. Neznámý formát události → 400.
 *   4. Před označením `paid` se stav objednávky ověří dotazem GET /v2/checkout/orders/{id}
 *      (jako GoPay) — rozhoduje částka a stav z API, ne z notifikace.
 * Idempotency: skip if order already paid.
 */

import { NextRequest, NextResponse } from 'next/server';
import { db, runWithServiceContext } from '@/lib/db/rls-pool';
import { getPayPalConfig, getPayPalOrder, verifyPayPalWebhookSignature } from '@/lib/payment/paypal';

export const dynamic = 'force-dynamic';

interface PayPalWebhookEvent {
  id: string;
  event_type: string;
  resource: {
    id: string;
    status?: string;
    amount?: { value: string; currency_code: string };
    supplementary_data?: {
      related_ids?: {
        order_id?: string;
      };
    };
    custom_id?: string;
  };
}

function isPayPalEvent(x: unknown): x is PayPalWebhookEvent {
  const e = x as PayPalWebhookEvent | null;
  return !!e && typeof e === 'object' && typeof e.id === 'string' && typeof e.event_type === 'string'
    && !!e.resource && typeof e.resource === 'object';
}

export async function POST(req: NextRequest): Promise<Response> {
  return runWithServiceContext(async () => {
    const rawBody = await req.text();

    const cfg = getPayPalConfig();
    if (!cfg.webhookId || !cfg.isConfigured) {
      console.warn('[paypal webhook] PAYPAL_WEBHOOK_ID / API credentials missing — rejecting');
      return NextResponse.json({ error: 'WEBHOOK_NOT_CONFIGURED' }, { status: 401 });
    }

    const verified = await verifyPayPalWebhookSignature({
      transmissionId: req.headers.get('paypal-transmission-id') ?? '',
      transmissionTime: req.headers.get('paypal-transmission-time') ?? '',
      certUrl: req.headers.get('paypal-cert-url') ?? '',
      authAlgo: req.headers.get('paypal-auth-algo') ?? '',
      transmissionSig: req.headers.get('paypal-transmission-sig') ?? '',
      rawBody,
    });
    if (!verified) {
      console.warn('[paypal webhook] invalid signature');
      return NextResponse.json({ error: 'INVALID_SIGNATURE' }, { status: 401 });
    }

    let event: unknown;
    try {
      event = JSON.parse(rawBody);
    } catch {
      return NextResponse.json({ error: 'INVALID_JSON' }, { status: 400 });
    }
    if (!isPayPalEvent(event)) {
      return NextResponse.json({ error: 'UNKNOWN_EVENT_FORMAT' }, { status: 400 });
    }

    if (event.event_type === 'PAYMENT.CAPTURE.COMPLETED') {
      const capture = event.resource;
      const paypalOrderId = capture.supplementary_data?.related_ids?.order_id;
      if (!paypalOrderId) {
        return NextResponse.json({ error: 'UNKNOWN_EVENT_FORMAT', reason: 'NO_ORDER_ID' }, { status: 400 });
      }

      // Autoritativní stav z PayPal API (ne z těla notifikace).
      let pp;
      try {
        pp = await getPayPalOrder(paypalOrderId);
      } catch (err) {
        console.error('[paypal webhook] PayPal order lookup failed:', err);
        return NextResponse.json({ error: 'PAYPAL_LOOKUP_FAILED' }, { status: 502 });
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
          [paypalOrderId],
        );

        if (orderRes.rows.length === 0) {
          await client.query('ROLLBACK');
          return NextResponse.json({ ok: true, reason: 'ORDER_NOT_FOUND' });
        }

        const order = orderRes.rows[0];
        const apiPaid = pp.status === 'COMPLETED' && pp.completedMinor > 0
          && pp.completedMinor >= order.total_amount && pp.currency === order.currency;

        await client.query(
          `INSERT INTO orders.payment_events
             (order_id, event_type, gopay_status, amount, raw_payload, payment_provider)
           VALUES ($1, $2, $3, $4, $5::jsonb, 'paypal')
           ON CONFLICT DO NOTHING`,
          [order.id, apiPaid ? 'payment_paid' : 'webhook_received', pp.status, pp.completedMinor,
           JSON.stringify({ paypalOrderId, captureId: capture.id, apiStatus: pp.status, apiCurrency: pp.currency, receivedAt: new Date().toISOString() })],
        );

        let triggerOrderCompleted = false;

        if (order.status === 'pending' && apiPaid) {
          const upd = await client.query<{ id: string }>(
            `UPDATE orders.orders
             SET status = 'paid', paid_at = NOW(), updated_at = NOW(),
                 payment_provider = 'paypal'
             WHERE id = $1 AND status = 'pending'
             RETURNING id`,
            [order.id],
          );
          triggerOrderCompleted = upd.rows.length > 0;
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
              console.error('[paypal webhook] order-completed trigger failed:', err);
            }
          })();
        }

        if (order.status === 'pending' && !apiPaid) {
          return NextResponse.json({ ok: false, reason: 'NOT_CONFIRMED_BY_GATEWAY', orderId: order.id }, { status: 409 });
        }
        return NextResponse.json({ ok: true, orderId: order.id });
      } catch (err) {
        await client.query('ROLLBACK');
        console.error('[paypal webhook] processing failed:', err);
        return NextResponse.json({ error: 'INTERNAL' }, { status: 500 });
      } finally {
        client.release();
      }
    }

    if (event.event_type === 'PAYMENT.CAPTURE.REFUNDED') {
      // Log refund; actual refund status update handled by admin action
      const paypalOrderId = event.resource.supplementary_data?.related_ids?.order_id;
      if (paypalOrderId) {
        const res = await db().query(
          `UPDATE orders.orders SET status = 'refunded', updated_at = NOW()
           WHERE gopay_payment_id = $1 AND status = 'paid'`,
          [paypalOrderId],
        );
        if (res.rowCount && res.rowCount > 0) {
          console.info('[paypal webhook] marked refunded for paypalOrderId', paypalOrderId);
        }
      }
      return NextResponse.json({ ok: true });
    }

    // Unhandled event type — acknowledge
    return NextResponse.json({ ok: true, eventType: event.event_type });
  });
}
