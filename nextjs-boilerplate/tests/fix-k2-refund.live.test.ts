// @vitest-environment node
/**
 * K2 — refund vracel jen DB, platební bránu nevolal nikdy.
 * Regresní testy proti IZOLOVANÉ DB + fake-gopay (bez mocků platebního toku):
 *   admin refund: úspěch (brána zavolána 1×, order refunded, tickety revoked),
 *                 chyba brány → refund_failed (žádné revoke, HTTP 502),
 *                 timeout brány → refund_failed,
 *                 idempotence: dvojí požadavek = jedno volání brány.
 *   self-refund: invariant „nikdy refunded bez volání brány".
 *
 * Běží jen s FIX_E2E=1.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { NextRequest } from 'next/server';
import type { Pool } from 'pg';
import { randomUUID } from 'crypto';
import { createLocalClone, hasLocalDb, type LocalClone } from './helpers/local-fixture';

const run = describe.skipIf(!hasLocalDb);
const GOPAY = process.env.FIX_GOPAY_URL ?? 'http://localhost:3998';
const ctl = (id: string, body: unknown) => fetch(`${GOPAY}/_ctl/${id}`, { method: 'POST', body: JSON.stringify(body) });
const refundMode = (id: string, mode: string) => fetch(`${GOPAY}/_ctl/${id}/refundmode`, { method: 'POST', body: JSON.stringify({ mode }) });
async function refundCallCount(paymentId: string): Promise<number> {
  const r = await fetch(`${GOPAY}/_ctl/refund-calls`);
  const calls = (await r.json()) as Array<{ path: string }>;
  return calls.filter((c) => c.path.includes(`/payment/${paymentId}/refund`)).length;
}

function reqJSON(method: string, path: string, body: unknown, headers: Record<string, string> = {}): NextRequest {
  return new Request(`http://localhost${path}`, {
    method, headers: { 'content-type': 'application/json', ...headers },
    body: body === undefined ? undefined : JSON.stringify(body),
  }) as unknown as NextRequest;
}

run('K2 refund přes bránu (izolovaná DB + fake-gopay)', () => {
  let clone: LocalClone;
  let pool: Pool;
  let checkoutPOST: (r: NextRequest) => Promise<Response>;
  let webhookGET: (r: NextRequest) => Promise<Response>;
  let adminRefundPOST: (r: NextRequest, ctx: { params: Promise<{ orderId: string }> }) => Promise<Response>;
  let selfRefundPOST: (r: NextRequest, ctx: { params: Promise<{ orderId: string }> }) => Promise<Response>;

  /** Reálný zaplacený order: checkout (guest) → fake-gopay PAID → webhook → paid + vydané lístky. */
  async function paidOrder(): Promise<{ orderId: string; paymentId: string; adminUserId: string; promoterId: string }> {
    const c = await clone.seed.chain({ totalQty: 50, remainingQty: 50, basePrice: 30000 });
    const ip = `198.51.100.${Math.floor(Math.random() * 254) + 1}`;
    const co = await checkoutPOST(reqJSON('POST', '/api/checkout', {
      eventId: c.eventId, ticketTypeId: c.ticketTypeId, quantity: 1,
      buyerEmail: `k2-${randomUUID().slice(0, 8)}@tixly.test`, buyerName: 'K2 Buyer',
    }, { 'x-forwarded-for': ip }));
    const cj = await co.json();
    if (co.status !== 200) throw new Error(`checkout ${co.status} ${JSON.stringify(cj)}`);
    await ctl(cj.paymentId, { state: 'PAID' });
    const wh = await webhookGET(reqJSON('GET', `/api/payments/gopay/webhook?id=${cj.paymentId}`, undefined));
    if (wh.status !== 200) throw new Error(`webhook ${wh.status}`);
    const st = (await pool.query<{ s: string }>(`SELECT status s FROM orders.orders WHERE id=$1`, [cj.orderId])).rows[0].s;
    expect(st, 'order je paid po webhooku').toBe('paid');
    // Webhook vydává lístky přes HTTP volání order-completed (v handler-level testu
    // bez běžícího serveru neproběhne) → vydáme je PRODUKČNÍ cestou (týž issuer),
    // ať má refund co revokovat.
    await clone.seed.tickets(cj.orderId);
    expect((await pool.query<{ n: number }>(`SELECT COUNT(*)::int n FROM tickets.tickets WHERE order_id=$1 AND status='valid'`, [cj.orderId])).rows[0].n).toBe(1);
    return { orderId: cj.orderId, paymentId: cj.paymentId, adminUserId: c.adminUserId, promoterId: c.promoterId };
  }
  const orderRow = async (id: string) => (await pool.query(`SELECT status, refund_error, refund_gateway_response FROM orders.orders WHERE id=$1`, [id])).rows[0];
  const validTickets = async (id: string) => (await pool.query<{ n: number }>(`SELECT COUNT(*)::int n FROM tickets.tickets WHERE order_id=$1 AND status='valid'`, [id])).rows[0].n;

  beforeAll(async () => {
    process.env.GOPAY_REFUND_TIMEOUT_MS = '2500'; // ať timeout varianta netrvá minuty
    clone = await createLocalClone();
    pool = clone.pool;
    checkoutPOST = (await import('@/app/api/checkout/route')).POST;
    webhookGET = (await import('@/app/api/payments/gopay/webhook/route')).GET;
    adminRefundPOST = (await import('@/app/api/admin/orders/[orderId]/refund/route')).POST as typeof adminRefundPOST;
    selfRefundPOST = (await import('@/app/api/buyer/orders/[orderId]/refund/route')).POST as typeof selfRefundPOST;
  }, 120_000);
  afterAll(async () => { await clone?.cleanup(); }, 30_000);

  it('úspěch: admin refund zavolá bránu 1×, order refunded, lístky revoked, odpověď brány uložena', async () => {
    const o = await paidOrder();
    const before = await refundCallCount(o.paymentId);
    const r = await adminRefundPOST(reqJSON('POST', `/api/admin/orders/${o.orderId}/refund`, { reason: 'customer_request' }, { 'x-user-id': o.adminUserId }), { params: Promise.resolve({ orderId: o.orderId }) });
    expect(r.status, await r.clone().text()).toBe(200);
    // PŘED opravou: 0 volání brány (jen DB). PO opravě: právě 1.
    expect(await refundCallCount(o.paymentId) - before, 'brána zavolána právě 1×').toBe(1);
    const row = await orderRow(o.orderId);
    expect(row.status).toBe('refunded');
    expect(await validTickets(o.orderId)).toBe(0);
    expect(row.refund_gateway_response, 'odpověď brány uložena').not.toBeNull();
  });

  it('idempotence: druhý refund už bránu nevolá, zůstává jeden refund', async () => {
    const o = await paidOrder();
    const before = await refundCallCount(o.paymentId);
    const r1 = await adminRefundPOST(reqJSON('POST', `/api/admin/orders/${o.orderId}/refund`, {}, { 'x-user-id': o.adminUserId }), { params: Promise.resolve({ orderId: o.orderId }) });
    expect(r1.status).toBe(200);
    const r2 = await adminRefundPOST(reqJSON('POST', `/api/admin/orders/${o.orderId}/refund`, {}, { 'x-user-id': o.adminUserId }), { params: Promise.resolve({ orderId: o.orderId }) });
    expect(r2.status).toBe(200);
    expect(await refundCallCount(o.paymentId) - before, 'dvojí požadavek = jedno volání brány').toBe(1);
    expect((await orderRow(o.orderId)).status).toBe('refunded');
  });

  it('chyba brány → refund_failed, žádné revoke, HTTP 502', async () => {
    const o = await paidOrder();
    await refundMode(o.paymentId, 'error');
    const r = await adminRefundPOST(reqJSON('POST', `/api/admin/orders/${o.orderId}/refund`, {}, { 'x-user-id': o.adminUserId }), { params: Promise.resolve({ orderId: o.orderId }) });
    expect(r.status).toBe(502);
    const row = await orderRow(o.orderId);
    expect(row.status).toBe('refund_failed');
    expect(row.refund_error, 'chyba uložena').toBeTruthy();
    expect(await validTickets(o.orderId), 'lístky NEZrevokovány při selhání brány').toBe(1);
  });

  it('timeout brány → refund_failed', async () => {
    const o = await paidOrder();
    await refundMode(o.paymentId, 'timeout');
    const r = await adminRefundPOST(reqJSON('POST', `/api/admin/orders/${o.orderId}/refund`, {}, { 'x-user-id': o.adminUserId }), { params: Promise.resolve({ orderId: o.orderId }) });
    expect(r.status).toBe(502);
    expect((await orderRow(o.orderId)).status).toBe('refund_failed');
    expect(await validTickets(o.orderId)).toBe(1);
  }, 30_000);

  it('self-refund: NIKDY nenastaví refunded bez volání brány (invariant)', async () => {
    const o = await paidOrder();
    const buyerId = (await pool.query<{ u: string }>(`SELECT user_id u FROM orders.orders WHERE id=$1`, [o.orderId])).rows[0].u;
    // povolit self-refund u promotéra (RLS viditelnost policy je SAMOSTATNÝ nález mimo K2)
    await pool.query(`INSERT INTO platform.refund_policies (promoter_id, allow_customer_self_refund) VALUES ($1, true)
                      ON CONFLICT (promoter_id) DO UPDATE SET allow_customer_self_refund = true`, [o.promoterId]);
    const before = await refundCallCount(o.paymentId);
    const r = await selfRefundPOST(reqJSON('POST', `/api/buyer/orders/${o.orderId}/refund`, { reason: 'audit' }, { 'x-user-id': buyerId }), { params: Promise.resolve({ orderId: o.orderId }) });
    const status = (await orderRow(o.orderId)).status;
    const gatewayCalls = await refundCallCount(o.paymentId) - before;
    // Buď refund proběhl (pak MUSEL zavolat bránu), nebo neproběhl (pak order není refunded).
    if (status === 'refunded') expect(gatewayCalls, 'refunded ⇒ brána zavolána').toBeGreaterThanOrEqual(1);
    else expect(status, 'bez brány ⇒ NENÍ refunded').not.toBe('refunded');
    // Nikdy: refunded se současně nulovým voláním brány (přesně ta K2 vada).
    expect(!(status === 'refunded' && gatewayCalls === 0), 'NIKDY refunded bez brány').toBe(true);
    void r;
  });
});
