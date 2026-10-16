// @vitest-environment node
/**
 * Kolo 6 / krok 3 (analýza, C-14) — POST /api/admin/orders/bulk-refund (hromadný refund, typicky
 * při zrušení akce) jen přepnul objednávky na `refunded` v DB: platební bránu nevolal, peníze
 * se nevrátily. Stejná třída jako K2 (kolo 1 opravilo jen jednotlivý refund). Navíc past: refund
 * po jedné pak odpoví „už vráceno" a peníze se nevrátí nikdy.
 *
 * Očekávané: každá objednávka projde sdíleným stavovým automatem executeOrderRefund (brána 1×,
 * `refunded` až po potvrzení); chyba brány → `refund_failed`, lístky zůstanou platné a výsledek
 * hlásí chybu. Proti izolované DB + fake-gopay, bez mocků platebního toku.
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
  const calls = (await (await fetch(`${GOPAY}/_ctl/refund-calls`)).json()) as Array<{ path: string }>;
  return calls.filter((c) => c.path.includes(`/payment/${paymentId}/refund`)).length;
}
function reqJSON(method: string, path: string, body: unknown, headers: Record<string, string> = {}): NextRequest {
  return new Request(`http://localhost${path}`, {
    method, headers: { 'content-type': 'application/json', ...headers },
    body: body === undefined ? undefined : JSON.stringify(body),
  }) as unknown as NextRequest;
}

run('Kolo 6 — hromadný refund vrací peníze přes bránu', () => {
  let clone: LocalClone;
  let pool: Pool;
  let c: Awaited<ReturnType<LocalClone['seed']['chain']>>;
  let checkoutPOST: (r: NextRequest) => Promise<Response>;
  let webhookGET: (r: NextRequest) => Promise<Response>;
  let bulkPOST: (r: NextRequest) => Promise<Response>;

  /** Reálně zaplacená objednávka na akci `c`: checkout → fake-gopay PAID → webhook → vydání. */
  async function paidOrder(): Promise<{ orderId: string; paymentId: string }> {
    const co = await checkoutPOST(reqJSON('POST', '/api/checkout', {
      eventId: c.eventId, ticketTypeId: c.ticketTypeId, quantity: 1,
      buyerEmail: `bulk-${randomUUID().slice(0, 8)}@tixly.test`, buyerName: 'Bulk Buyer',
    }, { 'x-forwarded-for': `198.51.100.${Math.floor(Math.random() * 254) + 1}` }));
    const cj = await co.json();
    if (co.status !== 200) throw new Error(`checkout ${co.status} ${JSON.stringify(cj)}`);
    await ctl(cj.paymentId, { state: 'PAID' });
    const wh = await webhookGET(reqJSON('GET', `/api/payments/gopay/webhook?id=${cj.paymentId}`, undefined));
    if (wh.status !== 200) throw new Error(`webhook ${wh.status}`);
    await clone.seed.tickets(cj.orderId);
    return { orderId: cj.orderId, paymentId: cj.paymentId };
  }
  const status = async (id: string) => (await pool.query<{ s: string }>(`SELECT status s FROM orders.orders WHERE id=$1`, [id])).rows[0].s;
  const valid = async (id: string) => (await pool.query<{ n: number }>(`SELECT COUNT(*)::int n FROM tickets.tickets WHERE order_id=$1 AND status='valid'`, [id])).rows[0].n;

  beforeAll(async () => {
    process.env.GOPAY_REFUND_TIMEOUT_MS = '2500';
    clone = await createLocalClone();
    pool = clone.pool;
    c = await clone.seed.chain({ totalQty: 50, remainingQty: 50, basePrice: 30000 });
    await pool.query(`UPDATE platform.promoters SET status='active' WHERE id=$1`, [c.promoterId]);
    checkoutPOST = (await import('@/app/api/checkout/route')).POST;
    webhookGET = (await import('@/app/api/payments/gopay/webhook/route')).GET;
    bulkPOST = (await import('@/app/api/admin/orders/bulk-refund/route')).POST as typeof bulkPOST;
  }, 180_000);
  afterAll(async () => { await clone?.cleanup(); }, 30_000);

  it('2 objednávky: brána zavolána 1× u každé, obě refunded, lístky zneplatněny', async () => {
    const a = await paidOrder();
    const b = await paidOrder();
    const before = [await refundCallCount(a.paymentId), await refundCallCount(b.paymentId)];
    const r = await bulkPOST(reqJSON('POST', '/api/admin/orders/bulk-refund',
      { orderIds: [a.orderId, b.orderId], reason: 'event_cancelled' }, { 'x-user-id': c.adminUserId }));
    const body = await r.text();
    expect(r.status, body).toBe(200);
    expect(await refundCallCount(a.paymentId) - before[0], `brána u A ${body}`).toBe(1);
    expect(await refundCallCount(b.paymentId) - before[1], 'brána u B').toBe(1);
    expect(await status(a.orderId)).toBe('refunded');
    expect(await status(b.orderId)).toBe('refunded');
    expect(await valid(a.orderId) + await valid(b.orderId)).toBe(0);
  });

  it('chyba brány u jedné: ta zůstane refund_failed s platnými lístky a výsledek hlásí chybu', async () => {
    const ok = await paidOrder();
    const bad = await paidOrder();
    await refundMode(bad.paymentId, 'error');
    const r = await bulkPOST(reqJSON('POST', '/api/admin/orders/bulk-refund',
      { orderIds: [ok.orderId, bad.orderId], reason: 'event_cancelled' }, { 'x-user-id': c.adminUserId }));
    const j = (await r.json()) as { outcomes: { orderId: string; status: string }[] };
    expect(await status(ok.orderId)).toBe('refunded');
    expect(await status(bad.orderId)).toBe('refund_failed');
    expect(await valid(bad.orderId), 'lístky při selhání brány zůstávají').toBe(1);
    expect(j.outcomes.find((o) => o.orderId === bad.orderId)?.status).toBe('error');
  });
});
