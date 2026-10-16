// @vitest-environment node
/**
 * Kolo 3 / závěr — regrese z R6 (d58c3ef) odhalená auditem 05 (C2a/C2c: 4/10 zaplaceno,
 * „timeout exceeded when trying to connect").
 *
 * Příčina: GoPay webhook po COMMITu dál DRŽEL svého klienta z db().connect() a uvnitř čekal na
 * in-process order-completed (a u R5/R6 na executeOrderRefund) — ty si berou DALŠÍ spojení ze
 * stejného poolu. Pod souběhem všechny webhooky drží po spojení a čekají na další → pool
 * vyčerpán, nové webhooky na connect() timeoutují a objednávky zůstanou nezaplacené.
 *
 * Test: malý pool (2), 6 objednávek × 3 souběžné webhooky PAID → všech 6 paid, 1 vstupenka na
 * objednávku, žádné 5xx. Totéž pro REFUNDED (R5, executeOrderRefund po commitu).
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { NextRequest } from 'next/server';
import type { Pool } from 'pg';
import { createLocalClone, hasLocalDb, type LocalClone } from './helpers/local-fixture';
import { throughMiddleware } from './helpers/through-middleware';

const run = describe.skipIf(!hasLocalDb);
const FAKE = 'http://localhost:3998';
type H = (r: NextRequest) => Promise<Response>;

run('Závěr (kolo 3) — webhook neblokuje pool během práce po commitu', () => {
  let clone: LocalClone;
  let pool: Pool;
  beforeAll(async () => {
    process.env.PG_POOL_MAX = '2';
    process.env.PG_DIRECT_POOL_MAX = '2';
    clone = await createLocalClone();
    pool = clone.pool;
    (await import('@/lib/payment/gopay-real'))._resetGopayCacheForTests();
  }, 120_000);
  afterAll(async () => { await clone?.cleanup(); }, 30_000);

  const hook = async (pid: string) => {
    const { GET } = await import('@/app/api/payments/gopay/webhook/route');
    return throughMiddleware(new Request(`http://localhost/api/payments/gopay/webhook?id=${pid}`), GET as H);
  };
  async function orders(n: number, status: 'pending' | 'paid') {
    const out: Array<{ orderId: string; pid: string }> = [];
    for (let i = 0; i < n; i++) {
      const c = await clone.seed.chain({ basePrice: 20000, remainingQty: 10 });
      const o = await clone.seed.order(c, { status, unitPrice: 20000 });
      if (status === 'paid') await clone.seed.tickets(o.orderId);
      const r = await fetch(`${FAKE}/api/payments/payment`, { method: 'POST', headers: { authorization: 'Bearer fake-token-payment-create' }, body: JSON.stringify({ amount: 20000, currency: 'CZK' }) });
      const pid = String(((await r.json()) as { id: number }).id);
      await pool.query(`UPDATE orders.orders SET gopay_payment_id=$2, payment_provider='gopay' WHERE id=$1`, [o.orderId, pid]);
      out.push({ orderId: o.orderId, pid });
    }
    return out;
  }

  it('6 objednávek × 3 souběžné PAID webhooky (pool 2) → 6× paid, 1 vstupenka na objednávku, žádné 5xx', async () => {
    const os = await orders(6, 'pending');
    await Promise.all(os.map((o) => fetch(`${FAKE}/_ctl/${o.pid}`, { method: 'POST', body: JSON.stringify({ state: 'PAID' }) })));
    const res = await Promise.all(os.flatMap((o) => [hook(o.pid), hook(o.pid), hook(o.pid)]));
    const codes = res.map((r) => r.status);
    expect(codes.filter((c) => c >= 500), JSON.stringify(codes)).toEqual([]);
    const ids = os.map((o) => o.orderId);
    expect((await pool.query(`SELECT count(*)::int n FROM orders.orders WHERE id = ANY($1::uuid[]) AND status='paid'`, [ids])).rows[0].n).toBe(6);
    const t = (await pool.query(`SELECT order_id, count(*)::int n FROM tickets.tickets WHERE order_id = ANY($1::uuid[]) GROUP BY 1`, [ids])).rows;
    expect(t.length).toBe(6);
    expect(t.every((x) => x.n === 1)).toBe(true);
  }, 120_000);

  it('6 objednávek × 3 souběžné REFUNDED webhooky (pool 2) → 6× refunded, žádné 5xx', async () => {
    const os = await orders(6, 'paid');
    await Promise.all(os.map((o) => fetch(`${FAKE}/_ctl/${o.pid}`, { method: 'POST', body: JSON.stringify({ state: 'REFUNDED' }) })));
    const res = await Promise.all(os.flatMap((o) => [hook(o.pid), hook(o.pid), hook(o.pid)]));
    expect(res.map((r) => r.status).filter((c) => c >= 500)).toEqual([]);
    expect((await pool.query(`SELECT count(*)::int n FROM orders.orders WHERE id = ANY($1::uuid[]) AND status='refunded'`, [os.map((o) => o.orderId)])).rows[0].n).toBe(6);
  }, 120_000);
});
