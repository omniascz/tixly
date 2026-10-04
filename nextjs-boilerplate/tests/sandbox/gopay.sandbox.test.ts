// @vitest-environment node
/**
 * GoPay SANDBOX (kolo 7, krok 6): platba → zaplacení → webhook → vstupenka, refund při chybě, refund.
 * Proti https://gw.sandbox.gopay.com/api a izolované lokální DB. Bez GOPAY_SANDBOX_* se přeskočí.
 * Návod a testovací karty: tests/sandbox/README.md.
 */
import { randomUUID } from 'crypto';
import type { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createLocalClone, type LocalClone } from '../helpers/local-fixture';
import {
  applySandboxEnv, assertSandboxTarget, jsonReq, missingSandboxEnv, routeOrderCompletedInProcess, waitForPayment,
} from './sandbox-helpers';

const missing = missingSandboxEnv('gopay');

describe.skipIf(missing.length > 0)('GoPay sandbox — platba, webhook, vstupenka, refund', () => {
  let clone: LocalClone;
  let pool: Pool;
  let restoreEnv: () => void;
  let restoreFetch: () => void;

  beforeAll(async () => {
    clone = await createLocalClone();
    pool = clone.pool;
    restoreEnv = applySandboxEnv('gopay');
    assertSandboxTarget('gopay');
    (await import('@/lib/payment/gopay-real'))._resetGopayCacheForTests();
    restoreFetch = await routeOrderCompletedInProcess();
  }, 120_000);
  afterAll(async () => {
    restoreFetch?.();
    restoreEnv?.();
    (await import('@/lib/payment/gopay-real'))._resetGopayCacheForTests();
    await clone?.cleanup();
  }, 60_000);

  const validTickets = async (id: string) =>
    (await pool.query<{ n: number }>(`SELECT count(*)::int n FROM tickets.tickets WHERE order_id=$1 AND status='valid'`, [id])).rows[0].n;
  const orderStatus = async (id: string) =>
    (await pool.query<{ status: string }>(`SELECT status FROM orders.orders WHERE id=$1`, [id])).rows[0].status;

  it('platba → zaplacení v sandboxu → webhook → paid + vstupenka; refund při chybě → refund_failed; refund → REFUNDED', async () => {
    const c = await clone.seed.chain({ totalQty: 10, remainingQty: 10, basePrice: 10000 });
    const { POST: checkout } = await import('@/app/api/checkout/route');
    const co = await checkout(jsonReq('POST', '/api/checkout', {
      eventId: c.eventId, ticketTypeId: c.ticketTypeId, quantity: 1,
      buyerEmail: `sandbox-${randomUUID().slice(0, 8)}@tixly.test`, buyerName: 'Sandbox Kupec',
    }, { 'x-forwarded-for': '198.51.110.10' }));
    const cj = (await co.json()) as { orderId: string; paymentId: string; gatewayUrl: string; provider: string };
    expect(co.status, JSON.stringify(cj)).toBe(200);
    expect(cj.provider).toBe('gopay');
    expect(new URL(cj.gatewayUrl).hostname).toContain('sandbox');
    // Testovací karty GoPay: výsledek určuje částka — končí-li na 00, platba projde (help.gopay.com/en/s/wk).
    const total = (await pool.query<{ t: number }>(`SELECT total_amount t FROM orders.orders WHERE id=$1`, [cj.orderId])).rows[0].t;
    expect(total % 100, `částka ${total} musí končit na 00, jinak sandbox platbu zamítne`).toBe(0);

    const { getGopayPaymentStatus } = await import('@/lib/payment/gopay-real');
    await waitForPayment(cj.gatewayUrl, async () => (await getGopayPaymentStatus(cj.paymentId)).paid);

    // Notifikace GoPay = GET ?id= (doc.gopay.com) — na localhost nedorazí, voláme webhook se skutečným ID.
    const { GET: webhook } = await import('@/app/api/payments/gopay/webhook/route');
    const wh = await webhook(jsonReq('GET', `/api/payments/gopay/webhook?id=${cj.paymentId}`));
    expect(wh.status, await wh.clone().text()).toBe(200);
    expect(await orderStatus(cj.orderId)).toBe('paid');
    const end = Date.now() + 20_000;
    while (Date.now() < end && (await validTickets(cj.orderId)) < 1) await new Promise((r) => setTimeout(r, 300));
    expect(await validTickets(cj.orderId), 'vstupenka vydaná').toBe(1);

    const { POST: refund } = await import('@/app/api/admin/orders/[orderId]/refund/route');
    const doRefund = () => refund(jsonReq('POST', `/api/admin/orders/${cj.orderId}/refund`, { reason: 'customer_request' }, { 'x-user-id': c.adminUserId }), { params: { orderId: cj.orderId } });

    // Refund při chybě brány: neplatné přihlašovací údaje → sandbox odmítne (peníze se nepohnou).
    const goodSecret = process.env.GOPAY_CLIENT_SECRET!;
    process.env.GOPAY_CLIENT_SECRET = 'neplatne-tajemstvi-sandbox';
    (await import('@/lib/payment/gopay-real'))._resetGopayCacheForTests();
    const bad = await doRefund();
    expect(bad.status, await bad.clone().text()).toBe(502);
    expect(await orderStatus(cj.orderId)).toBe('refund_failed');
    expect(await validTickets(cj.orderId), 'vstupenka zůstala platná').toBe(1);
    expect((await getGopayPaymentStatusFresh(goodSecret, cj.paymentId)).paid, 'u brány pořád zaplaceno').toBe(true);

    // Opakovaný refund se správnými údaji → vráceno u brány i v DB.
    process.env.GOPAY_CLIENT_SECRET = goodSecret;
    (await import('@/lib/payment/gopay-real'))._resetGopayCacheForTests();
    const ok = await doRefund();
    expect(ok.status, await ok.clone().text()).toBe(200);
    expect(await orderStatus(cj.orderId)).toBe('refunded');
    expect(await validTickets(cj.orderId)).toBe(0);
    expect((await getGopayPaymentStatus(cj.paymentId)).refunded, 'GoPay hlásí REFUNDED').toBe(true);
  }, Number(process.env.SANDBOX_PAY_TIMEOUT_MS ?? 300_000) + 120_000);
});

async function getGopayPaymentStatusFresh(secret: string, paymentId: string) {
  const m = await import('@/lib/payment/gopay-real');
  process.env.GOPAY_CLIENT_SECRET = secret;
  m._resetGopayCacheForTests();
  return m.getGopayPaymentStatus(paymentId);
}
