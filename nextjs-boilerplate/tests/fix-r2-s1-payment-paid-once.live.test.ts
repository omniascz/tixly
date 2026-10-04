// @vitest-environment node
/**
 * Kolo 2 / krok 5 — S1: jedna platba = jeden záznam `payment_paid` v orders.payment_events.
 *
 * Audit P5d / C2b: každé doručení webhooku zapsalo nový řádek `payment_paid` (3 webhooky = 3 řádky).
 * Test: 3× stejný webhook postupně a 3× souběžně (GoPay handler přes skutečný middleware,
 * stav brány ze simulátoru) → přesně 1 `payment_paid` na objednávku, objednávka paid, webhook
 * neodpoví 5xx (brána by ho jinak opakovala donekonečna).
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { NextRequest } from 'next/server';
import { createLocalClone, hasLocalDb, type LocalClone } from './helpers/local-fixture';
import { throughMiddleware } from './helpers/through-middleware';

const run = describe.skipIf(!hasLocalDb);
const FAKE = 'http://localhost:3998';

run('Krok 5 — S1: 3× stejný webhook → 1 payment_paid', () => {
  let clone: LocalClone;
  beforeAll(async () => { clone = await createLocalClone(); }, 120_000);
  afterAll(async () => { await clone?.cleanup(); }, 30_000);

  async function paidAtGateway() {
    const c = await clone.seed.chain({ basePrice: 40000 });
    const o = await clone.seed.order(c, { status: 'pending', unitPrice: 40000 });
    const p = await (await fetch(`${FAKE}/api/payments/payment`, { method: 'POST', headers: { authorization: 'Bearer fake-token-payment-create' }, body: JSON.stringify({ amount: 40000, currency: 'CZK' }) })).json() as { id: number };
    await fetch(`${FAKE}/_ctl/${p.id}`, { method: 'POST', body: JSON.stringify({ state: 'PAID' }) });
    await clone.pool.query(`UPDATE orders.orders SET gopay_payment_id=$2, payment_provider='gopay' WHERE id=$1`, [o.orderId, String(p.id)]);
    return { orderId: o.orderId, pid: String(p.id) };
  }
  const hook = async (pid: string) => {
    const { GET } = await import('@/app/api/payments/gopay/webhook/route');
    return throughMiddleware(new Request(`http://localhost/api/payments/gopay/webhook?id=${pid}`), GET as (r: NextRequest) => Promise<Response>);
  };
  const paidRows = async (orderId: string) =>
    (await clone.pool.query<{ n: number }>(`SELECT count(*)::int n FROM orders.payment_events WHERE order_id=$1 AND event_type='payment_paid'`, [orderId])).rows[0].n;
  const status = async (orderId: string) => (await clone.pool.query<{ s: string }>(`SELECT status s FROM orders.orders WHERE id=$1`, [orderId])).rows[0].s;

  it('3× postupně → 1 payment_paid, žádné 5xx', async () => {
    const o = await paidAtGateway();
    const codes: number[] = [];
    for (let i = 0; i < 3; i++) codes.push((await hook(o.pid)).status);
    expect(codes.every((c) => c < 500), JSON.stringify(codes)).toBe(true);
    expect(await status(o.orderId)).toBe('paid');
    expect(await paidRows(o.orderId)).toBe(1);
  });

  it('3× souběžně → 1 payment_paid, žádné 5xx', async () => {
    const o = await paidAtGateway();
    const rs = await Promise.all([hook(o.pid), hook(o.pid), hook(o.pid)]);
    expect(rs.every((r) => r.status < 500), JSON.stringify(rs.map((r) => r.status))).toBe(true);
    expect(await status(o.orderId)).toBe('paid');
    expect(await paidRows(o.orderId)).toBe(1);
  });

  it('DB: druhý payment_paid pro stejnou objednávku nevznikne ani přímým INSERTem', async () => {
    const o = await paidAtGateway();
    await hook(o.pid);
    await clone.pool.query(
      `INSERT INTO orders.payment_events (order_id, event_type, raw_payload) VALUES ($1,'payment_paid','{}') ON CONFLICT DO NOTHING`, [o.orderId]);
    expect(await paidRows(o.orderId)).toBe(1);
  });
});
