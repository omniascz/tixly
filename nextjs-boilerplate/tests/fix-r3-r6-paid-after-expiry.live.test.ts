// @vitest-environment node
/**
 * Kolo 3 / krok 2 — R6: platba potvrzená bránou AŽ PO expiraci objednávky.
 *
 * Expirace (cron expire-pending-orders) uvolnila kapacitu; zákazník ale u brány zaplatil.
 * Před opravou webhook PAID na `expired` objednávku nic neudělal (jen payment_event):
 * zákazník zaplatil a nemá vstupenky ani peníze zpět.
 *
 * Požadované chování:
 *   - kapacita volná  → objednávka obnovena (paid), kapacita znovu rezervována, lístky vydány;
 *   - kapacita pryč   → auto-refund přes executeOrderRefund (1 volání brány) + e-mail kupujícímu;
 *   - nikdy lístky nad kapacitu; opakované doručení webhooku nic nezdvojí.
 *
 * Expirace jde skutečnou cron routou; brána = fake-gopay (:3998); e-mail = Mailpit.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { NextRequest } from 'next/server';
import type { Pool } from 'pg';
import { createLocalClone, hasLocalDb, mailpitLatest, type LocalClone } from './helpers/local-fixture';
import { throughMiddleware } from './helpers/through-middleware';

const run = describe.skipIf(!hasLocalDb);
const FAKE = 'http://localhost:3998';
type H = (r: NextRequest) => Promise<Response>;

const gopayCtl = (id: string, obj: unknown) => fetch(`${FAKE}/_ctl/${id}`, { method: 'POST', body: JSON.stringify(obj) });
const refundCalls = async (pid: string) =>
  ((await (await fetch(`${FAKE}/_ctl/refund-calls`)).json()) as Array<{ path: string }>).filter((c) => c.path.includes(`/${pid}/`));

run('Krok 2 (kolo 3) — R6: zaplaceno po expiraci', () => {
  let clone: LocalClone;
  let pool: Pool;

  beforeAll(async () => {
    clone = await createLocalClone();
    pool = clone.pool;
    (await import('@/lib/payment/gopay-real'))._resetGopayCacheForTests();
  }, 120_000);
  afterAll(async () => { await clone?.cleanup(); }, 30_000);

  const hook = async () => (await import('@/app/api/payments/gopay/webhook/route')).GET as H;
  const callHook = async (pid: string) =>
    throughMiddleware(new Request(`http://localhost/api/payments/gopay/webhook?id=${pid}`), await hook());

  /** Pending objednávka qty ks, kapacita rezervovaná jako v checkoutu, platba v bráně; pak expirace cronem. */
  async function expiredOrder(qty = 2, unit = 25000) {
    const c = await clone.seed.chain({ basePrice: unit, remainingQty: 10 });
    const o = await clone.seed.order(c, { status: 'pending', quantity: qty, unitPrice: unit });
    await pool.query(`UPDATE catalog.ticket_types SET remaining_qty = remaining_qty - $2 WHERE id=$1`, [c.ticketTypeId, qty]);
    const r = await fetch(`${FAKE}/api/payments/payment`, { method: 'POST', headers: { authorization: 'Bearer fake-token-payment-create' }, body: JSON.stringify({ amount: qty * unit, currency: 'CZK' }) });
    const pid = String(((await r.json()) as { id: number }).id);
    await pool.query(`UPDATE orders.orders SET gopay_payment_id=$2, payment_provider='gopay', expires_at=now()-interval '1 minute' WHERE id=$1`, [o.orderId, pid]);
    const { POST: expire } = await import('@/app/api/internal/cron/expire-pending-orders/route');
    const ex = await throughMiddleware(new Request('http://localhost/api/internal/cron/expire-pending-orders', {
      method: 'POST', headers: { 'x-internal-token': process.env.INTERNAL_SERVICE_TOKEN! } }), expire as H);
    expect(ex.status, await ex.clone().text()).toBe(200);
    return { ...c, ...o, pid };
  }
  const state = async (orderId: string, ticketTypeId: string) => ({
    status: (await pool.query<{ status: string }>(`SELECT status FROM orders.orders WHERE id=$1`, [orderId])).rows[0].status,
    tickets: (await pool.query<{ status: string }>(`SELECT status FROM tickets.tickets WHERE order_id=$1`, [orderId])).rows.map((r) => r.status),
    remaining: (await pool.query<{ remaining_qty: number }>(`SELECT remaining_qty FROM catalog.ticket_types WHERE id=$1`, [ticketTypeId])).rows[0].remaining_qty,
  });

  it('kapacita volná → objednávka obnovena (paid), kapacita znovu rezervována, lístky vydány; retry nic nezdvojí', async () => {
    const o = await expiredOrder(2);
    expect(await state(o.orderId, o.ticketTypeId)).toEqual({ status: 'expired', tickets: [], remaining: 10 });

    await gopayCtl(o.pid, { state: 'PAID' });
    const res = await callHook(o.pid);
    expect(res.status, await res.clone().text()).toBe(200);

    const after = await state(o.orderId, o.ticketTypeId);
    expect(after).toEqual({ status: 'paid', tickets: ['valid', 'valid'], remaining: 8 });
    expect(await refundCalls(o.pid)).toHaveLength(0);

    await callHook(o.pid);
    expect(await state(o.orderId, o.ticketTypeId)).toEqual(after);
  });

  it('kapacita pryč → auto-refund (1 volání brány), refunded, 0 lístků, kapacita nedotčena, e-mail kupujícímu; retry = žádný 2. refund', async () => {
    const o = await expiredOrder(2);
    // mezitím prodáno jinému kupci — zbyl 1 lístek, objednávka chce 2
    await pool.query(`UPDATE catalog.ticket_types SET remaining_qty = 1 WHERE id=$1`, [o.ticketTypeId]);

    await gopayCtl(o.pid, { state: 'PAID' });
    const res = await callHook(o.pid);
    expect(res.status, await res.clone().text()).toBe(200);

    expect(await state(o.orderId, o.ticketTypeId)).toEqual({ status: 'refunded', tickets: [], remaining: 1 });
    const calls = await refundCalls(o.pid);
    expect(calls).toHaveLength(1);

    // e-mail kupujícímu (fire-and-forget → krátce počkat)
    let mail = null;
    for (let i = 0; i < 20 && !mail; i++) { mail = await mailpitLatest(o.email); if (!mail) await new Promise((r) => setTimeout(r, 250)); }
    expect(mail, 'e-mail o vrácení platby').not.toBeNull();
    expect(mail!.html).toContain(o.orderId.slice(0, 8));

    // retry brány (stav u brány je teď REFUNDED po našem refundu, ale i PAID retry nesmí refundovat 2×)
    await gopayCtl(o.pid, { state: 'PAID' });
    await callHook(o.pid);
    expect(await refundCalls(o.pid)).toHaveLength(1);
    expect((await state(o.orderId, o.ticketTypeId)).status).toBe('refunded');
  });

  it('souběh: 2 expirované objednávky po 1 ks, volný 1 ks → jen jedna obnovena, druhá refundována (nikdy nad kapacitu)', async () => {
    const a = await expiredOrder(1);
    const c = { ...a };
    // druhá objednávka na TENTÝŽ typ
    const o2 = await clone.seed.order(a, { status: 'expired', quantity: 1, unitPrice: 25000 });
    const r = await fetch(`${FAKE}/api/payments/payment`, { method: 'POST', headers: { authorization: 'Bearer fake-token-payment-create' }, body: JSON.stringify({ amount: 25000, currency: 'CZK' }) });
    const pid2 = String(((await r.json()) as { id: number }).id);
    await pool.query(`UPDATE orders.orders SET gopay_payment_id=$2, payment_provider='gopay' WHERE id=$1`, [o2.orderId, pid2]);
    await pool.query(`UPDATE catalog.ticket_types SET remaining_qty = 1 WHERE id=$1`, [c.ticketTypeId]);

    await gopayCtl(a.pid, { state: 'PAID' });
    await gopayCtl(pid2, { state: 'PAID' });
    await Promise.all([callHook(a.pid), callHook(pid2)]);

    const s1 = await state(a.orderId, c.ticketTypeId);
    const s2 = await state(o2.orderId, c.ticketTypeId);
    expect([s1.status, s2.status].sort()).toEqual(['paid', 'refunded']);
    expect(s1.tickets.length + s2.tickets.length).toBe(1);
    expect(s1.remaining).toBe(0);
    expect((await refundCalls(a.pid)).length + (await refundCalls(pid2)).length).toBe(1);
  });
});
