/**
 * POST /api/payments/triplea/webhook
 *
 * Triple-A crypto payment notification. Triple-A POSTuje JSON s podpisem v
 * hlavičce `Triplea-Signature: t=<unix>,v1=<hmac>`. Ověříme HMAC nad SYROVÝM
 * tělem (verifyTripleAWebhook), pak zpracujeme.
 *
 * status 'good' = plná validní platba → order paid + payment_events +
 * /api/internal/order-completed (PDF + email). 'invalid' → cancelled.
 * Ostatní (none/short/hold) → jen zalogujeme.
 *
 * Idempotence: retry (5×) — když je order už paid, jen 200. Order hledáme podle
 * gopay_payment_id = payment_reference (uloženo při createTripleAPayment).
 */
import { NextRequest, NextResponse } from 'next/server';
import { db, runWithServiceContext } from '@/lib/db/rls-pool';
import { getTripleAConfig, getTripleAPayment, verifyTripleAWebhook } from '@/lib/payment/triplea';

export const dynamic = 'force-dynamic';

interface TripleAPayload {
  event?: string;
  payment_reference?: string;
  status?: string; // none | short | hold | good | invalid
  order_amount?: number;
  order_currency?: string;
  webhook_data?: { order_id?: string };
}

export async function POST(req: NextRequest): Promise<Response> {
  return runWithServiceContext(async () => {
    // Syrové tělo NUTNÉ pro HMAC (před JSON.parse)
    const rawBody = await req.text();
    // Kolo 2: bez kompletní konfigurace (tajemství + API přístup pro ověření stavu) fail-closed.
    if (!getTripleAConfig().isConfigured) {
      return NextResponse.json({ error: 'WEBHOOK_NOT_CONFIGURED' }, { status: 401 });
    }
    const verification = verifyTripleAWebhook(
      rawBody,
      req.headers.get('triplea-signature'),
      Date.now(),
    );
    if (!verification.valid) {
      console.warn('[triplea webhook] podpis neplatný:', verification.reason);
      return NextResponse.json({ error: 'INVALID_SIGNATURE', reason: verification.reason }, { status: 401 });
    }

    let payload: TripleAPayload;
    try {
      payload = JSON.parse(rawBody) as TripleAPayload;
    } catch {
      return NextResponse.json({ error: 'INVALID_JSON' }, { status: 400 });
    }

    const paymentReference = payload.payment_reference;
    if (!paymentReference) {
      return NextResponse.json({ error: 'MISSING_PAYMENT_REFERENCE' }, { status: 400 });
    }
    // Kolo 2: autoritativní stav + částka z Triple-A API (ne z těla notifikace) — jako GoPay.
    let api;
    try {
      api = await getTripleAPayment(paymentReference);
    } catch (err) {
      console.error('[triplea webhook] payment lookup failed:', err);
      return NextResponse.json({ error: 'TRIPLEA_LOOKUP_FAILED' }, { status: 502 });
    }
    const status = api.status || api.paymentTier || 'none';
    const paid = api.status === 'good' || api.paymentTier === 'good';

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
        [paymentReference],
      );

      if (orderRes.rows.length === 0) {
        await client.query('ROLLBACK');
        // Neznámý payment_reference — nevracíme error (Triple-A by retry-oval)
        return NextResponse.json({ ok: true, reason: 'ORDER_NOT_FOUND', paymentReference });
      }
      const order = orderRes.rows[0];

      // Integrita částky: order_amount (hlavní jednotky) → halíře, musí pokrýt total_amount
      // chybějící / nulová částka NIKDY nepokrývá cenu (dřív `null → true`)
      const paidMinor = api.orderAmount !== null ? Math.round(api.orderAmount * 100) : null;
      const amountCovers = paidMinor !== null && paidMinor > 0 && paidMinor >= order.total_amount;
      const currencyMatches = !!api.orderCurrency && api.orderCurrency === order.currency;
      const amountOk = amountCovers && currencyMatches;
      const effectivePaid = paid && amountOk;

      await client.query(
        `INSERT INTO orders.payment_events
           (order_id, event_type, gopay_status, amount, raw_payload, payment_provider)
         VALUES ($1, $2, $3, $4, $5::jsonb, 'crypto')
           ON CONFLICT DO NOTHING`,
        [
          order.id,
          effectivePaid ? 'payment_paid' : status === 'invalid' ? 'payment_failed' : 'webhook_received',
          status,
          paidMinor,
          JSON.stringify({
            source: 'triplea-webhook',
            paymentReference,
            status,
            orderAmount: payload.order_amount ?? null,
            orderCurrency: payload.order_currency ?? null,
            receivedAt: new Date().toISOString(),
          }),
        ],
      );

      if (paid && !amountOk && order.status === 'pending') {
        await client.query('COMMIT');
        console.warn(
          `[triplea webhook] amount/currency mismatch order=${order.id} expected=${order.total_amount}${order.currency} paid=${paidMinor}${payload.order_currency ?? ''}`,
        );
        return NextResponse.json({ ok: false, reason: 'AMOUNT_MISMATCH', orderId: order.id }, { status: 409 });
      }

      let triggerOrderCompleted = false;
      if (effectivePaid && order.status === 'pending') {
        const upd = await client.query<{ id: string }>(
          `UPDATE orders.orders
              SET status = 'paid', paid_at = NOW(), updated_at = NOW()
            WHERE id = $1 AND status = 'pending'
            RETURNING id`,
          [order.id],
        );
        triggerOrderCompleted = upd.rows.length > 0;
      } else if (status === 'invalid' && order.status === 'pending') {
        await client.query(
          `UPDATE orders.orders SET status = 'cancelled', updated_at = NOW()
            WHERE id = $1 AND status = 'pending'`,
          [order.id],
        );
      }

      await client.query('COMMIT');

      if (triggerOrderCompleted) {
        void (async () => {
          try {
            const internalToken = process.env.INTERNAL_SERVICE_TOKEN;
            const appUrl = process.env.APP_URL ?? process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3000';
            if (!internalToken) {
              console.warn('[triplea webhook] INTERNAL_SERVICE_TOKEN missing — skipping order-completed');
              return;
            }
            await fetch(`${appUrl}/api/internal/order-completed`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json', 'x-internal-token': internalToken },
              body: JSON.stringify({ orderId: order.id, paymentProvider: 'crypto' }),
            });
          } catch (err) {
            console.error('[triplea webhook] order-completed trigger failed:', err);
          }
        })();
      }

      return NextResponse.json({
        ok: true,
        orderId: order.id,
        status,
        newStatus: effectivePaid ? 'paid' : status === 'invalid' ? 'cancelled' : order.status,
      });
    } catch (err) {
      await client.query('ROLLBACK').catch(() => undefined);
      console.error('[triplea webhook] processing failed:', err);
      return NextResponse.json({ error: 'INTERNAL' }, { status: 500 });
    } finally {
      client.release();
    }
  });
}
