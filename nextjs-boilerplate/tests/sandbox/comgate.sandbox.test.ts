// @vitest-environment node
/**
 * ComGate v TEST režimu (kolo 7, krok 6): platba → zaplacení → webhook → vstupenka, refund při chybě, refund.
 * Proti https://payments.comgate.cz/v2.0 s test=true a izolované lokální DB. Bez COMGATE_SANDBOX_* se přeskočí.
 * Návod: tests/sandbox/README.md.
 */
import { randomUUID } from 'crypto';
import type { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createLocalClone, type LocalClone } from '../helpers/local-fixture';
import {
  applySandboxEnv, assertSandboxTarget, jsonReq, missingSandboxEnv, routeOrderCompletedInProcess, waitForPayment,
} from './sandbox-helpers';

const missing = missingSandboxEnv('comgate');

describe.skipIf(missing.length > 0)('ComGate test režim — platba, webhook, vstupenka, refund', () => {
  let clone: LocalClone;
  let pool: Pool;
  let restoreEnv: () => void;
  let restoreFetch: () => void;

  beforeAll(async () => {
    clone = await createLocalClone();
    pool = clone.pool;
    restoreEnv = applySandboxEnv('comgate');
    assertSandboxTarget('comgate');
    (await import('@/lib/payment/comgate'))._resetComGateCacheForTests();
    restoreFetch = await routeOrderCompletedInProcess();
  }, 120_000);
  afterAll(async () => {
    restoreFetch?.();
    restoreEnv?.();
    (await import('@/lib/payment/comgate'))._resetComGateCacheForTests();
    await clone?.cleanup();
  }, 60_000);

  const validTickets = async (id: string) =>
    (await pool.query<{ n: number }>(`SELECT count(*)::int n FROM tickets.tickets WHERE order_id=$1 AND status='valid'`, [id])).rows[0].n;
  const order = async (id: string) =>
    (await pool.query<{ status: string; payment_provider: string }>(`SELECT status, payment_provider FROM orders.orders WHERE id=$1`, [id])).rows[0];

  it('platba → zaplacení (test režim) → webhook → paid + vstupenka; refund při chybě → refund_failed; refund → refunded', async () => {
    const c = await clone.seed.chain({ totalQty: 10, remainingQty: 10, basePrice: 10000 });
    const { POST: checkout } = await import('@/app/api/checkout/route');
    const co = await checkout(jsonReq('POST', '/api/checkout', {
      eventId: c.eventId, ticketTypeId: c.ticketTypeId, quantity: 1,
      buyerEmail: `sandbox-${randomUUID().slice(0, 8)}@tixly.test`, buyerName: 'Sandbox Kupec',
    }, { 'x-forwarded-for': '198.51.110.20' }));
    const cj = (await co.json()) as { orderId: string; paymentId: string; gatewayUrl: string; provider: string };
    expect(co.status, JSON.stringify(cj)).toBe(200);
    expect(cj.provider).toBe('comgate');
    expect((await order(cj.orderId)).payment_provider).toBe('comgate');

    const { getComGatePaymentStatus } = await import('@/lib/payment/comgate');
    await waitForPayment(cj.gatewayUrl, async () => (await getComGatePaymentStatus(cj.paymentId)).paid);

    // Notifikace v2.0 = JSON (apidoc.comgate.cz/en/push-notifikace); webhook si stav ověří u brány.
    const { POST: webhook } = await import('@/app/api/payments/comgate/webhook/route');
    const wh = await webhook(jsonReq('POST', '/api/payments/comgate/webhook', {
      transId: cj.paymentId, refId: cj.orderId, secret: process.env.COMGATE_SECRET, status: 'PAID', test: 'true',
    }));
    expect(wh.status, await wh.clone().text()).toBe(200);
    expect((await order(cj.orderId)).status).toBe('paid');
    const end = Date.now() + 20_000;
    while (Date.now() < end && (await validTickets(cj.orderId)) < 1) await new Promise((r) => setTimeout(r, 300));
    expect(await validTickets(cj.orderId), 'vstupenka vydaná').toBe(1);

    const { POST: refund } = await import('@/app/api/admin/orders/[orderId]/refund/route');
    const doRefund = () => refund(jsonReq('POST', `/api/admin/orders/${cj.orderId}/refund`, { reason: 'customer_request' }, { 'x-user-id': c.adminUserId }), { params: { orderId: cj.orderId } });

    // Refund při chybě brány: neplatné tajemství → ComGate odmítne (401), peníze se nepohnou.
    const goodSecret = process.env.COMGATE_SECRET!;
    process.env.COMGATE_SECRET = 'neplatne-tajemstvi-test';
    (await import('@/lib/payment/comgate'))._resetComGateCacheForTests();
    const bad = await doRefund();
    expect(bad.status, await bad.clone().text()).toBe(502);
    expect((await order(cj.orderId)).status).toBe('refund_failed');
    expect(await validTickets(cj.orderId), 'vstupenka zůstala platná').toBe(1);

    process.env.COMGATE_SECRET = goodSecret;
    (await import('@/lib/payment/comgate'))._resetComGateCacheForTests();
    const ok = await doRefund();
    expect(ok.status, await ok.clone().text()).toBe(200);
    expect((await order(cj.orderId)).status).toBe('refunded');
    expect(await validTickets(cj.orderId)).toBe(0);
    // ComGate nemá stav REFUNDED (stavy-plateb) — potvrzení je odpověď /refund.json {code:0}, uložená u objednávky.
    const resp = (await pool.query(`SELECT refund_gateway_response r FROM orders.orders WHERE id=$1`, [cj.orderId])).rows[0].r;
    expect(JSON.stringify(resp)).toContain('"code":0');
  }, Number(process.env.SANDBOX_PAY_TIMEOUT_MS ?? 300_000) + 120_000);
});
