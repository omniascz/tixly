// @vitest-environment node
/**
 * Kolo 3 / krok 2 — R5: refund hlášený bránou (webhook REFUNDED — refund z portálu brány,
 * chargeback) musí mít STEJNÉ účinky jako refund z Tixly: objednávka `refunded`, vstupenky
 * zneplatněné, kapacita vrácená. Idempotentně (opakované doručení webhooku nic nezdvojí)
 * a BEZ druhého volání refundu u brány (peníze už vrátila brána).
 *
 * Před opravou: větev `status.refunded` jen přepsala orders.status='refunded' —
 * vstupenky zůstaly `valid` (zákazník má peníze i platný lístek) a kapacita se nevrátila.
 * Navíc PARTIALLY_REFUNDED označilo celou objednávku jako refunded.
 *
 * Brána = tests/helpers/fake-gopay.mjs (:3998); požadavek jde přes skutečný middleware.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { NextRequest } from 'next/server';
import type { Pool } from 'pg';
import { createLocalClone, hasLocalDb, type LocalClone } from './helpers/local-fixture';
import { throughMiddleware } from './helpers/through-middleware';

const run = describe.skipIf(!hasLocalDb);
const FAKE = 'http://localhost:3998';
type H = (r: NextRequest) => Promise<Response>;

const gopayCtl = (id: string, obj: unknown) => fetch(`${FAKE}/_ctl/${id}`, { method: 'POST', body: JSON.stringify(obj) });
const refundCalls = async (pid: string) =>
  ((await (await fetch(`${FAKE}/_ctl/refund-calls`)).json()) as Array<{ path: string }>).filter((c) => c.path.includes(`/${pid}/`));

run('Krok 2 (kolo 3) — R5: webhook REFUNDED → refunded + revoke + kapacita, idempotentně, bez 2. refundu', () => {
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

  /** Zaplacená objednávka (2 ks) s vydanými lístky, navázaná na platbu v simulátoru brány. */
  async function paidOrderWithTickets(qty = 2, unit = 25000) {
    const c = await clone.seed.chain({ basePrice: unit, remainingQty: 10 });
    const o = await clone.seed.order(c, { status: 'paid', quantity: qty, unitPrice: unit });
    await clone.seed.tickets(o.orderId);
    const r = await fetch(`${FAKE}/api/payments/payment`, { method: 'POST', headers: { authorization: 'Bearer fake-token-payment-create' }, body: JSON.stringify({ amount: qty * unit, currency: 'CZK' }) });
    const pid = String(((await r.json()) as { id: number }).id);
    await pool.query(`UPDATE orders.orders SET gopay_payment_id=$2, payment_provider='gopay', paid_at=now() WHERE id=$1`, [o.orderId, pid]);
    return { ...c, orderId: o.orderId, pid };
  }
  const state = async (orderId: string, ticketTypeId: string) => ({
    status: (await pool.query<{ status: string }>(`SELECT status FROM orders.orders WHERE id=$1`, [orderId])).rows[0].status,
    tickets: (await pool.query<{ status: string }>(`SELECT status FROM tickets.tickets WHERE order_id=$1 ORDER BY id`, [orderId])).rows.map((r) => r.status),
    remaining: (await pool.query<{ remaining_qty: number }>(`SELECT remaining_qty FROM catalog.ticket_types WHERE id=$1`, [ticketTypeId])).rows[0].remaining_qty,
  });

  it('REFUNDED: objednávka refunded, všechny lístky revoked, kapacita +2, 0 volání refundu u brány; 2. doručení nic nezdvojí', async () => {
    const o = await paidOrderWithTickets(2);
    const before = await state(o.orderId, o.ticketTypeId);
    expect(before.status).toBe('paid');
    expect(before.tickets).toEqual(['valid', 'valid']);

    await gopayCtl(o.pid, { state: 'REFUNDED' });
    const res = await callHook(o.pid);
    expect(res.status, await res.clone().text()).toBe(200);

    const after = await state(o.orderId, o.ticketTypeId);
    expect(after.status).toBe('refunded');
    expect(after.tickets).toEqual(['revoked', 'revoked']);
    expect(after.remaining).toBe(before.remaining + 2);
    expect(await refundCalls(o.pid)).toHaveLength(0);

    const ord = (await pool.query(`SELECT refund_completed_at, refunded_amount_halire FROM orders.orders WHERE id=$1`, [o.orderId])).rows[0];
    expect(ord.refund_completed_at).not.toBeNull();
    expect(Number(ord.refunded_amount_halire)).toBe(50000);

    // idempotence: opakované doručení (retry brány)
    const res2 = await callHook(o.pid);
    expect(res2.status).toBe(200);
    expect(await state(o.orderId, o.ticketTypeId)).toEqual(after);
    expect(await refundCalls(o.pid)).toHaveLength(0);
  });

  it('REFUNDED doručený 3× souběžně → kapacita vrácena právě jednou', async () => {
    const o = await paidOrderWithTickets(2);
    const before = await state(o.orderId, o.ticketTypeId);
    await gopayCtl(o.pid, { state: 'REFUNDED' });
    const rs = await Promise.all([callHook(o.pid), callHook(o.pid), callHook(o.pid)]);
    expect(rs.map((r) => r.status).every((s) => s < 500)).toBe(true);
    const after = await state(o.orderId, o.ticketTypeId);
    expect(after.status).toBe('refunded');
    expect(after.tickets).toEqual(['revoked', 'revoked']);
    expect(after.remaining).toBe(before.remaining + 2);
    expect(await refundCalls(o.pid)).toHaveLength(0);
  });

  it('PARTIALLY_REFUNDED: objednávka NENÍ označena jako celá refundovaná a lístky se hromadně nezneplatní', async () => {
    const o = await paidOrderWithTickets(2);
    const before = await state(o.orderId, o.ticketTypeId);
    await gopayCtl(o.pid, { state: 'PARTIALLY_REFUNDED' });
    const res = await callHook(o.pid);
    expect(res.status).toBe(200);
    expect(await state(o.orderId, o.ticketTypeId)).toEqual(before);
    const ev = (await pool.query(`SELECT event_type, gopay_status FROM orders.payment_events WHERE order_id=$1`, [o.orderId])).rows;
    expect(ev).toContainEqual({ event_type: 'payment_refunded', gopay_status: 'PARTIALLY_REFUNDED' });
  });
});
