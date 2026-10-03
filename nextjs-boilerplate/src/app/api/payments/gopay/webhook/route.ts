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
import { getGopayConfig, getGopayPaymentStatus } from '@/lib/payment/gopay-real';
import { releaseOrderCapacity } from '@/lib/orders/release-capacity';
import { executeOrderRefund } from '@/lib/payment/refund-order';
import { reacquireOrderCapacity } from '@/lib/orders/reacquire-capacity';
import type { Pool } from 'pg';

/** Stavy, ze kterých refund hlášený bránou dokončíme (pending: kapacita je ještě držená). */
const EXTERNAL_REFUNDABLE = ['paid', 'paid_partial', 'refund_failed', 'pending'];


export const dynamic = 'force-dynamic';

/** R6: e-mail kupujícímu, že platba za expirovanou objednávku byla vrácena. */
async function notifyLatePaymentRefund(orderId: string, amountHalire: number, currency: string): Promise<void> {
  const r = await db().query<{ email: string; event_title: string | null }>(
    `SELECT u.email, e.title AS event_title
       FROM orders.orders o JOIN identity.users u ON u.id = o.user_id
       LEFT JOIN catalog.events e ON e.id = o.event_id
      WHERE o.id = $1`,
    [orderId],
  );
  const row = r.rows[0];
  if (!row?.email) return;
  const amount = (amountHalire / 100).toLocaleString('cs-CZ', { minimumFractionDigits: 2 });
  const esc = (v: string) => v.replace(/[&<>"']/g, (ch) => `&#${ch.charCodeAt(0)};`);
  const { sendMail } = await import('@/lib/email/mailer');
  await sendMail({
    to: row.email,
    subject: `Tixly — platba vrácena (objednávka ${orderId.slice(0, 8)})`,
    html: `<p>Dobrý den,</p>
<p>vaše platba za objednávku <strong>${orderId.slice(0, 8)}</strong>${row.event_title ? ` (${esc(row.event_title)})` : ''}
dorazila až po vypršení rezervace a vstupenky už nebylo možné vydat — kapacita byla mezitím prodána.</p>
<p>Částku <strong>${amount} ${esc(currency)}</strong> jsme vám vrátili stejnou platební metodou.</p>
<p>Tým Tixly</p>`,
  });
}

/** Vystavení vstupenek + e-mail: handler internal/order-completed in-process (nezávisí na APP_URL). */
async function completeOrderInProcess(orderId: string): Promise<void> {
  const internalToken = process.env.INTERNAL_SERVICE_TOKEN;
  if (!internalToken) {
    console.warn('[gopay webhook] INTERNAL_SERVICE_TOKEN missing — skipping order-completed');
    return;
  }
  const { POST: completeOrder } = await import('@/app/api/internal/order-completed/route');
  const done = await completeOrder(new NextRequest(
    `${process.env.APP_URL ?? 'http://localhost:3000'}/api/internal/order-completed`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-internal-token': internalToken },
      body: JSON.stringify({ orderId }),
    },
  ));
  if (!done.ok) console.error('[gopay webhook] order-completed failed', orderId, done.status);
}

async function handleWebhook(req: NextRequest, source: 'GET' | 'POST'): Promise<Response> {
  const url = new URL(req.url);
  const paymentId = url.searchParams.get('id') ?? url.searchParams.get('paymentId');

  if (!paymentId) {
    return NextResponse.json({ error: 'MISSING_PAYMENT_ID' }, { status: 400 });
  }

  // Kolo 2: fail-closed bez konfigurace — mimo produkci by getGopayPaymentStatus vrátil
  // DEV_STUB `paid:true` a kdokoli by přes ?id= označil objednávku zaplacenou.
  if (!getGopayConfig().isConfigured) {
    return NextResponse.json({ error: 'WEBHOOK_NOT_CONFIGURED' }, { status: 401 });
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

    // Integrita částky: GoPay-reportovaná zaplacená částka (halíře) musí pokrýt
    // order.total_amount (taky halíře) a měna sedět. Jinak NEoznačíme paid —
    // underpayment / manipulace by jinak vystavila vstupenky pod cenou.
    // Kolo 2: chybějící / nulová / nečíselná částka NIKDY nepokrývá cenu (dřív `true`
    // → DEV_STUB nebo PAID s amount 0 označil objednávku zaplacenou). Měna musí sedět.
    const paidAmount = Number(status.amountHalire);
    const amountCovers = Number.isFinite(paidAmount) && paidAmount > 0 && paidAmount >= order.total_amount;
    const currencyMatches = !!status.currency && status.currency === order.currency;
    const amountOk = amountCovers && currencyMatches;
    const effectivePaid = status.paid && amountOk;

    // Zápis do orders.payment_events (canonical webhook log + EET audit trail)
    await client.query(
      `INSERT INTO orders.payment_events
         (order_id, event_type, gopay_status, amount, raw_payload, payment_provider)
       VALUES ($1, $2, $3, $4, $5::jsonb, 'gopay')
           ON CONFLICT DO NOTHING`,
      [
        order.id,
        effectivePaid ? 'payment_paid' : status.refunded ? 'payment_refunded' : 'webhook_received',
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
    let externalRefund = false;
    let lateRefundReason: string | null = null;

    if (status.paid && !amountOk && order.status === 'pending') {
      // Zaplaceno, ale částka/měna nesedí → necháme pending, zalogováno výše.
      await client.query('COMMIT');
      console.warn(
        `[gopay webhook] amount/currency mismatch order=${order.id} expected=${order.total_amount}${order.currency} paid=${status.amountHalire}${status.currency ?? ''}`,
      );
      return NextResponse.json(
        { ok: false, reason: 'AMOUNT_MISMATCH', orderId: order.id },
        { status: 409 },
      );
    }

    if (effectivePaid && order.status === 'expired') {
      // Kolo 3 / R6: zaplaceno po expiraci. Kapacitu uvolnila expirace → zkusíme ji znovu
      // rezervovat (podmíněně jako checkout, všechno nebo nic). Povede se → objednávka
      // obnovena a lístky vydány; nepovede se → auto-refund po commitu (nikdy nad kapacitu).
      const re = await reacquireOrderCapacity(client, order.id);
      if (re.ok) {
        const upd = await client.query<{ id: string }>(
          `UPDATE orders.orders
           SET status = 'paid', paid_at = NOW(), updated_at = NOW(),
               payment_provider = COALESCE(payment_provider, 'gopay')
           WHERE id = $1 AND status = 'expired'
           RETURNING id`,
          [order.id],
        );
        triggerOrderCompleted = upd.rows.length > 0;
        await client.query(
          `INSERT INTO audit.audit_log (schema_name, table_name, record_id, action, actor_type, new_values)
           VALUES ('orders', 'orders', $1, 'UPDATE', 'system', $2::jsonb)`,
          [order.id, JSON.stringify({ kind: 'late_payment_restored', status: 'paid', paymentId })],
        );
      } else {
        lateRefundReason = re.reason;
      }
    } else if (effectivePaid && order.status === 'cancelled') {
      // Zrušenou objednávku (kupující ji stornoval) neobnovujeme — peníze zpět.
      lateRefundReason = 'ORDER_CANCELLED';
    } else if (effectivePaid && order.status === 'pending') {
      const upd = await client.query<{ id: string }>(
        `UPDATE orders.orders
         SET status = 'paid', paid_at = NOW(), updated_at = NOW(),
             payment_provider = COALESCE(payment_provider, 'gopay')
         WHERE id = $1 AND status = 'pending'
         RETURNING id`,
        [order.id],
      );
      triggerOrderCompleted = upd.rows.length > 0;
    } else if (status.state === 'REFUNDED' && EXTERNAL_REFUNDABLE.includes(order.status)) {
      // Kolo 3 / R5: plný refund provedený bránou (portál brány, chargeback). Dokončí se
      // PO commitu této transakce sdíleným automatem executeOrderRefund (ten si objednávku
      // zamyká sám — tady ji držíme FOR UPDATE, takže uvnitř by to byl deadlock).
      externalRefund = true;
    } else if (status.state === 'PARTIALLY_REFUNDED') {
      // Částečný refund u brány: nevíme, které lístky — objednávku NEoznačujeme jako
      // celou refundovanou (dřív ano, s platnými lístky). Zalogováno v payment_events výše.
      console.warn(`[gopay webhook] PARTIALLY_REFUNDED order=${order.id} — ponecháno k ručnímu dořešení`);
    } else if (
      (status.state === 'CANCELED' || status.state === 'TIMEOUTED') &&
      order.status === 'pending'
    ) {
      const upd = await client.query<{ id: string }>(
        `UPDATE orders.orders
         SET status = $2, updated_at = NOW()
         WHERE id = $1 AND status = 'pending'
         RETURNING id`,
        [order.id, status.state === 'TIMEOUTED' ? 'expired' : 'cancelled'],
      );
      // FIX K3: zrušená/timeoutovaná platba musí OKAMŽITĚ vrátit kapacitu (GA
      // množství, sedadla, promo max_uses). Dřív se jen přepsal status a rezervace
      // držela inventář až do cronu (který navíc padal). Tentýž helper jako cron;
      // guard `status='pending'` + RETURNING → uvolní se jen při reálném přechodu
      // (idempotence proti opakovanému doručení webhooku).
      if (upd.rows.length > 0) {
        await releaseOrderCapacity(client, [order.id]);
      }
    }

    await client.query('COMMIT');

    let refundOutcome: string | null = null;
    if (externalRefund) {
      // Peníze už vrátila brána → executeOrderRefund BEZ volání brány; tytéž efekty jako
      // refund z Tixly (revoke lístků + releaseOrderCapacity). Idempotentní: refunded → already,
      // refund_pending (běží refund z Tixly) → in_progress, efekty dokončí ten.
      const result = await executeOrderRefund({
        pool: db() as unknown as Pool,
        orderId: order.id,
        amountHalire: order.total_amount,
        finalStatus: 'refunded',
        allowFromStatuses: EXTERNAL_REFUNDABLE,
        gatewayRefundedExternally: { raw: { source: 'gopay_webhook', paymentId, state: status.state, amount: status.amountHalire } },
        applyEffects: async (c) => {
          await c.query(
            `UPDATE tickets.tickets SET status = 'revoked', revoked_at = NOW(), updated_at = NOW()
              WHERE order_id = $1 AND status <> 'revoked'`,
            [order.id],
          );
          await releaseOrderCapacity(c, [order.id]);
        },
      });
      refundOutcome = result.outcome;
    }

    if (lateRefundReason) {
      // R6: platba za objednávku, kterou už nelze splnit → vrátit peníze přes sdílený automat
      // (volá bránu; idempotentní — souběžný/opakovaný webhook narazí na refund_pending/refunded).
      const result = await executeOrderRefund({
        pool: db() as unknown as Pool,
        orderId: order.id,
        amountHalire: paidAmount,
        finalStatus: 'refunded',
        allowFromStatuses: ['expired', 'cancelled'],
        // Kapacita už byla uvolněna expirací/zrušením a lístky nevznikly → žádné efekty navíc.
        applyEffects: async () => {},
        audit: async (c) => {
          await c.query(
            `INSERT INTO audit.audit_log (schema_name, table_name, record_id, action, actor_type, new_values)
             VALUES ('orders', 'orders', $1, 'UPDATE', 'system', $2::jsonb)`,
            [order.id, JSON.stringify({ kind: 'late_payment_refunded', reason: lateRefundReason, amount_halire: paidAmount, paymentId })],
          );
        },
      });
      refundOutcome = result.outcome;
      if (result.outcome === 'refunded') {
        await notifyLatePaymentRefund(order.id, paidAmount, order.currency).catch((err) =>
          console.error('[gopay webhook] late-payment refund email failed:', err));
      } else if (result.outcome === 'failed') {
        console.error(`[gopay webhook] late-payment auto-refund FAILED order=${order.id} — refund_failed, k ručnímu dořešení`);
      }
    }

    // Vystavení vstupenek + e-mail. Kolo 3: in-process a AWAIT (dřív fire-and-forget fetch na
    // APP_URL — při nedostupném APP_URL / zmraženém serverless runtime lístky nevznikly).
    if (triggerOrderCompleted) {
      try {
        await completeOrderInProcess(order.id);
      } catch (err) {
        console.error('[gopay webhook] order-completed trigger failed:', err);
      }
    }

    return NextResponse.json({
      ok: true,
      orderId: order.id,
      state: status.state,
      newStatus: lateRefundReason
        ? (refundOutcome === 'refunded' ? 'refunded' : order.status)
        : status.paid ? 'paid' : status.state === 'REFUNDED' ? 'refunded' : order.status,
      ...(lateRefundReason ? { lateRefundReason } : {}),
      ...(refundOutcome ? { refundOutcome } : {}),
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
