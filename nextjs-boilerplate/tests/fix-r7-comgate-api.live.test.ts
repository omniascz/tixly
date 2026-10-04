// @vitest-environment node
/**
 * Kolo 7 / krok 6 — ComGate klient proti simulátoru postavenému PODLE OFICIÁLNÍ DOKUMENTACE
 * (tests/helpers/fake-comgate.mjs, https://apidoc.comgate.cz/en/api/rest/).
 *
 * Nález: klient volal neexistující cesty (/payment, /payment/transaction/{id}, …/refund místo
 * /payment.json, /payment/transId/{id}.json, /refund.json), posílal `currency` místo `curr`, label až
 * 255 znaků (API: 1–16), ze stavu četl `state` místo `status` (zaplacená platba by nikdy nebyla paid),
 * webhook bral jen formulář (v2.0 posílá JSON) a refund neměl timeout. Úspěšnou cestu žádný test nespustil.
 *
 * Očekávané: checkout → platba u brány → PAID → webhook (JSON i formulář) → objednávka paid → vstupenka
 * vydaná přes order-completed; refund → refunded + zneplatněné vstupenky; chyba / timeout brány →
 * refund_failed, vstupenky zůstanou platné.
 */
import { randomUUID } from 'crypto';
import type { NextRequest } from 'next/server';
import type { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { startFakeComGate } from './helpers/fake-comgate.mjs';
import { createLocalClone, hasLocalDb, type LocalClone } from './helpers/local-fixture';

const run = describe.skipIf(!hasLocalDb);
type H = (r: NextRequest, ctx?: unknown) => Promise<Response>;
type Fake = Awaited<ReturnType<typeof startFakeComGate>>;

const req = (method: string, path: string, body?: unknown, headers: Record<string, string> = {}, raw?: string) =>
  new Request(`http://localhost${path}`, {
    method,
    headers: { 'content-type': 'application/json', ...headers },
    body: raw ?? (body === undefined ? undefined : JSON.stringify(body)),
  }) as unknown as NextRequest;

run('Kolo 7 — ComGate podle oficiálního API (simulátor)', () => {
  let clone: LocalClone;
  let pool: Pool;
  let cg: Fake;
  const realFetch = globalThis.fetch;
  const saved: Record<string, string | undefined> = {};
  const ENV = ['PAYMENT_PROVIDER', 'COMGATE_MERCHANT', 'COMGATE_SECRET', 'COMGATE_TEST', 'COMGATE_API_BASE_URL', 'COMGATE_REFUND_TIMEOUT_MS'];

  beforeAll(async () => {
    clone = await createLocalClone();
    pool = clone.pool;
    cg = await startFakeComGate();
    for (const k of ENV) saved[k] = process.env[k];
    Object.assign(process.env, {
      PAYMENT_PROVIDER: 'comgate', COMGATE_MERCHANT: cg.merchant, COMGATE_SECRET: cg.secret, COMGATE_TEST: 'true',
      COMGATE_API_BASE_URL: cg.apiBaseUrl, COMGATE_REFUND_TIMEOUT_MS: '800',
    });
    (await import('@/lib/payment/comgate'))._resetComGateCacheForTests();
    // order-completed (vydání vstupenek), které webhook volá přes HTTP, doručíme in-process skutečnému handleru.
    const { POST: completed } = await import('@/app/api/internal/order-completed/route');
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const u = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url);
      if (u.pathname === '/api/internal/order-completed') return completed(new Request(`http://localhost${u.pathname}`, init) as unknown as NextRequest);
      return realFetch(input, init);
    }) as typeof fetch;
  }, 120_000);
  afterAll(async () => {
    globalThis.fetch = realFetch;
    for (const k of ENV) { if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k]; }
    (await import('@/lib/payment/comgate'))._resetComGateCacheForTests();
    await cg?.close();
    await clone?.cleanup();
  }, 60_000);

  const validTickets = async (orderId: string) =>
    (await pool.query<{ n: number }>(`SELECT COUNT(*)::int n FROM tickets.tickets WHERE order_id=$1 AND status='valid'`, [orderId])).rows[0].n;
  const orderRow = async (id: string) =>
    (await pool.query(`SELECT status, payment_provider, gopay_payment_id, refund_error FROM orders.orders WHERE id=$1`, [id])).rows[0];
  const waitFor = async (fn: () => Promise<boolean>, ms = 15_000) => {
    const end = Date.now() + ms;
    while (Date.now() < end) { if (await fn()) return true; await new Promise((r) => setTimeout(r, 200)); }
    return false;
  };

  /** checkout → platba u ComGate → PAID → webhook → paid + vydaná vstupenka */
  async function paidOrder(notify: 'json' | 'form' = 'json') {
    const c = await clone.seed.chain({ totalQty: 20, remainingQty: 20, basePrice: 45000 });
    const { POST: checkout } = await import('@/app/api/checkout/route');
    const co = await checkout(req('POST', '/api/checkout', {
      eventId: c.eventId, ticketTypeId: c.ticketTypeId, quantity: 1,
      buyerEmail: `cg-${randomUUID().slice(0, 8)}@tixly.test`, buyerName: 'ComGate Kupec',
    }, { 'x-forwarded-for': `198.51.101.${Math.floor(Math.random() * 250) + 1}` }));
    const cj = (await co.json()) as { orderId: string; paymentId: string; provider: string; gatewayUrl: string };
    expect(co.status, JSON.stringify(cj)).toBe(200);
    expect(cj.provider).toBe('comgate');
    const pay = cg.payments.get(cj.paymentId);
    expect(pay, 'platba založená u brány přes /v2.0/payment.json').toBeTruthy();
    expect(pay).toMatchObject({ price: 45000, curr: 'CZK', refId: cj.orderId, test: true });
    expect(pay.label.length).toBeLessThanOrEqual(16);
    expect(pay.request.url_paid, 'návratová adresa předaná bráně').toContain(cj.orderId);

    cg.setStatus(cj.paymentId, 'PAID');
    const { POST: webhook } = await import('@/app/api/payments/comgate/webhook/route');
    const n = { transId: cj.paymentId, merchant: cg.merchant, test: 'true', price: '45000', curr: 'CZK', label: pay.label, refId: cj.orderId, email: pay.email, secret: cg.secret, status: 'PAID' };
    const wh = notify === 'json'
      ? await webhook(req('POST', '/api/payments/comgate/webhook', n))
      : await webhook(req('POST', '/api/payments/comgate/webhook', undefined, { 'content-type': 'application/x-www-form-urlencoded' }, new URLSearchParams(n).toString()));
    expect(wh.status, await wh.clone().text()).toBe(200);
    expect(await orderRow(cj.orderId)).toMatchObject({ status: 'paid', payment_provider: 'comgate', gopay_payment_id: cj.paymentId });
    expect(await waitFor(async () => (await validTickets(cj.orderId)) === 1), 'vstupenka vydaná').toBe(true);
    return { ...cj, adminUserId: c.adminUserId };
  }

  const refund = async (o: { orderId: string; adminUserId: string }) => {
    const { POST } = await import('@/app/api/admin/orders/[orderId]/refund/route');
    return (POST as unknown as H)(req('POST', `/api/admin/orders/${o.orderId}/refund`, { reason: 'customer_request' }, { 'x-user-id': o.adminUserId }), { params: { orderId: o.orderId } });
  };

  it('platba → zaplacení → webhook (JSON, v2.0) → vstupenka; refund → refunded u brány i v DB', async () => {
    const o = await paidOrder('json');
    const r = await refund(o);
    expect(r.status, await r.clone().text()).toBe(200);
    const call = cg.calls.filter((c) => c.path === '/v2.0/refund.json').at(-1);
    expect(call?.body).toMatchObject({ transId: o.paymentId, amount: 45000, test: true });
    expect(cg.payments.get(o.paymentId).refunded).toBe(45000);
    expect((await orderRow(o.orderId)).status).toBe('refunded');
    expect(await validTickets(o.orderId)).toBe(0);
  });

  it('webhook ve formátu formuláře (v1.0) se přijme taky; špatné tajemství 401', async () => {
    await paidOrder('form');
    const { POST: webhook } = await import('@/app/api/payments/comgate/webhook/route');
    const bad = await webhook(req('POST', '/api/payments/comgate/webhook', { transId: 'X', refId: randomUUID(), secret: 'spatne', status: 'PAID' }));
    expect(bad.status).toBe(401);
  });

  it('refund při chybě brány → refund_failed, vstupenka platná; timeout brány → refund_failed do pár sekund', async () => {
    const o = await paidOrder();
    cg.setRefundMode(o.paymentId, 'error');
    const r = await refund(o);
    expect(r.status).toBe(502);
    expect((await orderRow(o.orderId)).status).toBe('refund_failed');
    expect(await validTickets(o.orderId)).toBe(1);

    const o2 = await paidOrder();
    cg.setRefundMode(o2.paymentId, 'timeout');
    const t0 = Date.now();
    const r2 = await refund(o2);
    expect(r2.status).toBe(502);
    expect(Date.now() - t0).toBeLessThan(10_000);
    expect((await orderRow(o2.orderId)).status).toBe('refund_failed');
    expect(await validTickets(o2.orderId)).toBe(1);
  }, 60_000);
});
