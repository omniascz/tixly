/**
 * POST /api/payments/comgate/webhook
 *
 * ComGate notification handler. Posílá form-urlencoded POST s:
 *   transId, status, price, currency, refId, secret, ...
 *
 * Verifikace:
 *   1. secret v body se musí rovnat COMGATE_SECRET (env)
 *   2. Pokud ověření selže → 401
 *   3. Pokud passes → ověření stavu opět GET z API (defense in depth)
 *
 * Flow je analogický /api/payments/gopay/webhook — odlišuje se jen
 * verifikací a parsováním body.
 */

import { timingSafeEqual } from 'crypto';
import { db, runWithServiceContext } from '@/lib/db/rls-pool';
import { NextRequest, NextResponse } from 'next/server';
import { getComGatePaymentStatus, getComGateConfig } from '@/lib/payment/comgate';


export const dynamic = 'force-dynamic';

function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a, 'utf8');
  const bb = Buffer.from(b, 'utf8');
  if (ab.length !== bb.length) return false;
  return timingSafeEqual(ab, bb);
}

export async function POST(req: NextRequest): Promise<Response> {
  return runWithServiceContext(async () => {

  const formData = await req.formData().catch(() => null);
  if (!formData) {
    return NextResponse.json({ error: 'INVALID_BODY' }, { status: 400 });
  }

  const transId = String(formData.get('transId') ?? '');
  const refId = String(formData.get('refId') ?? '');
  const providedSecret = String(formData.get('secret') ?? '');

  if (!transId) {
    return NextResponse.json({ error: 'MISSING_TRANS_ID' }, { status: 400 });
  }

  // Ověř secret
  const config = getComGateConfig();
  if (!config.isConfigured) {
    console.error('[comgate webhook] not configured — rejecting');
    // Kolo 2: 4xx (fail-closed) — bez konfigurace nelze notifikaci ověřit vůbec.
    return NextResponse.json({ error: 'WEBHOOK_NOT_CONFIGURED' }, { status: 401 });
  }
  if (!safeEqual(providedSecret, config.secret)) {
    return NextResponse.json({ error: 'INVALID_SECRET' }, { status: 401 });
  }

  // Defense in depth — ověř stav přes API
  let status;
  try {
    status = await getComGatePaymentStatus(transId);
  } catch (err) {
    console.error('[comgate webhook] getStatus failed:', err);
    return NextResponse.json({ error: 'COMGATE_LOOKUP_FAILED' }, { status: 502 });
  }

  const client = await db().connect();
  try {
    await client.query('BEGIN');

    // Lookup order — preferujeme orderId z refId, fallback gopay_payment_id
    const orderRes = await client.query<{
      id: string;
      status: string;
      total_amount: number;
      currency: string;
    }>(
      `SELECT id, status, total_amount, currency
       FROM orders.orders
       WHERE id = $1::uuid OR gopay_payment_id = $2
       FOR UPDATE
       LIMIT 1`,
      [refId, transId],
    );

    if (orderRes.rows.length === 0) {
      await client.query('ROLLBACK');
      return NextResponse.json({ ok: true, reason: 'ORDER_NOT_FOUND', transId, refId });
    }

    const order = orderRes.rows[0];

    // Integrita částky (halíře) + měna — viz gopay webhook. Underpayment se
    // nesmí proměnit ve vystavené vstupenky.
    // Kolo 2: chybějící / nulová / nečíselná částka NIKDY nepokrývá cenu (dřív `true`
    // → DEV_STUB nebo PAID s amount 0 označil objednávku zaplacenou). Měna musí sedět.
    const paidAmount = Number(status.amountHalire);
    const amountCovers = Number.isFinite(paidAmount) && paidAmount > 0 && paidAmount >= order.total_amount;
    const currencyMatches = !!status.currency && status.currency === order.currency;
    const amountOk = amountCovers && currencyMatches;
    const effectivePaid = status.paid && amountOk;

    await client.query(
      `INSERT INTO orders.payment_events
         (order_id, event_type, gopay_status, amount, raw_payload, payment_provider)
       VALUES ($1, $2, $3, $4, $5::jsonb, 'comgate')`,
      [
        order.id,
        effectivePaid ? 'payment_paid' : status.refunded ? 'payment_refunded' : 'webhook_received',
        status.state,
        status.amountHalire,
        JSON.stringify({
          transId,
          refId,
          state: status.state,
          paid: status.paid,
          refunded: status.refunded,
          amountHalire: status.amountHalire,
          currency: status.currency,
          receivedAt: new Date().toISOString(),
        }),
      ],
    );

    let triggerOrderCompleted = false;

    if (status.paid && !amountOk && order.status === 'pending') {
      await client.query('COMMIT');
      console.warn(
        `[comgate webhook] amount/currency mismatch order=${order.id} expected=${order.total_amount}${order.currency} paid=${status.amountHalire}${status.currency ?? ''}`,
      );
      return new Response('code=0&message=OK', {
        status: 200,
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      });
    }

    if (effectivePaid && order.status === 'pending') {
      const upd = await client.query<{ id: string }>(
        `UPDATE orders.orders
         SET status = 'paid', paid_at = NOW(), updated_at = NOW(),
             gopay_payment_id = COALESCE(gopay_payment_id, $2),
             payment_provider = COALESCE(payment_provider, 'comgate')
         WHERE id = $1 AND status = 'pending'
         RETURNING id`,
        [order.id, transId],
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
      (status.state === 'CANCELLED' || status.state === 'TIMEOUTED') &&
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

    if (triggerOrderCompleted) {
      void (async () => {
        try {
          const internalToken = process.env.INTERNAL_SERVICE_TOKEN;
          const appUrl = process.env.APP_URL ?? 'http://localhost:3000';
          if (!internalToken) return;
          await fetch(`${appUrl}/api/internal/order-completed`, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'x-internal-token': internalToken,
            },
            body: JSON.stringify({ orderId: order.id }),
          });
        } catch (err) {
          console.error('[comgate webhook] order-completed trigger failed:', err);
        }
      })();
    }

    // ComGate očekává jednoduchou textovou odpověď „code=0&message=OK"
    return new Response('code=0&message=OK', {
      status: 200,
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('[comgate webhook] processing failed:', err);
    return new Response('code=1500&message=Internal error', {
      status: 500,
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    });
  } finally {
    client.release();
  }

  });
}
