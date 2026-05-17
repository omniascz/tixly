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

import { NextRequest, NextResponse } from 'next/server';
import { Pool } from 'pg';
import { timingSafeEqual } from 'crypto';
import { getComGatePaymentStatus, getComGateConfig } from '@/lib/payment/comgate';

let pool: Pool | null = null;
function db(): Pool {
  if (!pool) pool = new Pool({ connectionString: process.env.DATABASE_URL });
  return pool;
}

export const dynamic = 'force-dynamic';

function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a, 'utf8');
  const bb = Buffer.from(b, 'utf8');
  if (ab.length !== bb.length) return false;
  return timingSafeEqual(ab, bb);
}

export async function POST(req: NextRequest): Promise<Response> {
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
    return NextResponse.json({ error: 'NOT_CONFIGURED' }, { status: 503 });
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
    }>(
      `SELECT id, status
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

    const order = orderRes.rows[0]!;

    await client.query(
      `INSERT INTO orders.payment_events
         (order_id, event_type, gopay_status, amount, raw_payload, payment_provider)
       VALUES ($1, $2, $3, $4, $5::jsonb, 'comgate')`,
      [
        order.id,
        status.paid ? 'payment_paid' : status.refunded ? 'payment_refunded' : 'webhook_received',
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

    if (status.paid && order.status === 'pending') {
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
}
