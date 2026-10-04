// @vitest-environment node
/**
 * Kolo 3 / krok 2 — BEFORE UPDATE guard (migrace 486) na orders.orders, tickets.tickets,
 * orders.order_items.
 *
 * Nález: RLS omezuje, KTERÉ řádky kupec mění (své), ne KTERÉ sloupce. Pod kontextem kupce
 * (tixly_app, app.role='user') šlo vlastní objednávce přepsat status na 'paid', částku, měnu,
 * platební identifikátor i akci, a lístku status/typ/cenu.
 *
 * Část A — přímo v DB pod tixly_app v kontextu kupce: každý chráněný sloupec → 42501;
 *          nechráněný sloupec (cancellation_reason, holder_name) projde.
 * Část B — service/system, promotér a platform admin chráněné sloupce měnit smí.
 * Část C — legitimní cesty kupce fungují dál (přes skutečný middleware): zrušení,
 *          self-refund, výměna, upgrade, mobilní platba, uplatnění pojistky.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { NextRequest } from 'next/server';
import { Pool, type PoolClient } from 'pg';
import { randomUUID } from 'crypto';
import { createLocalClone, hasLocalDb, type LocalClone } from './helpers/local-fixture';
import { throughMiddleware } from './helpers/through-middleware';

const run = describe.skipIf(!hasLocalDb);
const FAKE = 'http://localhost:3998';
type H = (r: NextRequest, ctx?: unknown) => Promise<Response>;
const APP_DSN = process.env.FIX_DB_APP_URL ?? 'postgresql://tixly_app:fixapp@localhost:55632/e2e';

run('Krok 2 (kolo 3) — guard chráněných sloupců objednávek a lístků', () => {
  let clone: LocalClone;
  let owner: Pool;
  let app: Pool;
  let sign: (u: { id: string; email: string }) => Promise<string>;

  beforeAll(async () => {
    clone = await createLocalClone();
    owner = clone.pool;
    app = new Pool({ connectionString: APP_DSN, max: 3 });
    process.env.STRIPE_SECRET_KEY = 'sk_test_fix';
    process.env.STRIPE_API_BASE_URL = `${FAKE}/stripe`;
    (await import('@/lib/payment/gopay-real'))._resetGopayCacheForTests();
    const { signAccessToken } = await import('@/lib/auth');
    sign = (u) => signAccessToken({ id: u.id, email: u.email, name: 'T' } as never, { isPlatformAdmin: false, promoterMemberships: [] });
  }, 120_000);
  afterAll(async () => { await app?.end(); await clone?.cleanup(); }, 30_000);

  /** Jeden UPDATE pod tixly_app v daném kontextu; vrací null (prošlo, počet řádků) nebo SQLSTATE. */
  async function asCtx(ctx: Record<string, string>, sql: string, params: unknown[]): Promise<{ code: string | null; rows: number }> {
    const c: PoolClient = await app.connect();
    try {
      await c.query('BEGIN');
      for (const [k, v] of Object.entries(ctx)) await c.query(`SELECT set_config($1, $2, true)`, [k, v]);
      const r = await c.query(sql, params);
      await c.query('ROLLBACK');
      return { code: null, rows: r.rowCount ?? 0 };
    } catch (e) {
      await c.query('ROLLBACK').catch(() => {});
      return { code: (e as { code?: string }).code ?? 'ERR', rows: 0 };
    } finally { c.release(); }
  }
  const buyerCtx = (uid: string) => ({ 'app.current_user_id': uid, 'app.role': 'user' });

  async function paidOrder(opts: { unit?: number; qty?: number } = {}) {
    const c = await clone.seed.chain({ basePrice: opts.unit ?? 25000, remainingQty: 20 });
    const o = await clone.seed.order(c, { status: 'paid', quantity: opts.qty ?? 1, unitPrice: opts.unit ?? 25000 });
    await clone.seed.tickets(o.orderId);
    const email = (await owner.query(`SELECT email FROM identity.users WHERE id=$1`, [o.userId])).rows[0].email as string;
    return { ...c, ...o, email, ticketId: (await owner.query(`SELECT id FROM tickets.tickets WHERE order_id=$1 LIMIT 1`, [o.orderId])).rows[0].id as string };
  }

  // ───────────────────────── A: kupec přímo v DB ─────────────────────────
  describe('A — kupec (tixly_app, app.role=user) chráněné sloupce měnit nesmí', () => {
    const orderCols: Array<[string, string]> = [
      ['status', `'paid'`], ['total_amount', '1'], ['currency', `'EUR'`], ['gopay_payment_id', `'forged'`],
      ['payment_provider', `'stripe'`], ['stripe_payment_intent_id', `'pi_forged'`], ['paid_at', 'now()'],
      ['discount_halire', '99999'], ['refunded_amount_halire', '1'],
    ];
    it.each(orderCols)('orders.orders.%s → 42501', async (col, val) => {
      const o = await paidOrder();
      await owner.query(`UPDATE orders.orders SET status='pending', paid_at=NULL WHERE id=$1`, [o.orderId]);
      const r = await asCtx(buyerCtx(o.userId), `UPDATE orders.orders SET ${col} = ${val} WHERE id = $1`, [o.orderId]);
      expect(r.code, `kupec změnil ${col}`).toBe('42501');
    });
    it('orders.orders.event_id (vazba na akci) → 42501', async () => {
      const o = await paidOrder(); const other = await clone.seed.chain();
      const r = await asCtx(buyerCtx(o.userId), `UPDATE orders.orders SET event_id = $2 WHERE id = $1`, [o.orderId, other.eventId]);
      expect(r.code).toBe('42501');
    });
    it('tickets.tickets status / ticket_type_id / original_price → 42501', async () => {
      const o = await paidOrder(); const other = await clone.seed.chain();
      for (const [sql, p] of [
        [`UPDATE tickets.tickets SET status='valid' WHERE id=$1`, [o.ticketId]],
        [`UPDATE tickets.tickets SET ticket_type_id=$2 WHERE id=$1`, [o.ticketId, other.ticketTypeId]],
        [`UPDATE tickets.tickets SET original_price=1 WHERE id=$1`, [o.ticketId]],
      ] as Array<[string, unknown[]]>) {
        await owner.query(`UPDATE tickets.tickets SET status='revoked' WHERE id=$1`, [o.ticketId]);
        const r = await asCtx(buyerCtx(o.userId), sql, p);
        expect(r.code, sql).toBe('42501');
      }
    });
    it('orders.order_items unit_price / quantity → 42501', async () => {
      const o = await paidOrder();
      // order_items kupci RLS k UPDATE nezpřístupňuje vůbec (0 řádků); guard je druhá vrstva.
      for (const sql of [`UPDATE orders.order_items SET unit_price=1, total_price=1 WHERE order_id=$1`,
                         `UPDATE orders.order_items SET quantity=quantity+5 WHERE order_id=$1`]) {
        const r = await asCtx(buyerCtx(o.userId), sql, [o.orderId]);
        expect(r.code === '42501' || (r.code === null && r.rows === 0), `${sql}: ${JSON.stringify(r)}`).toBe(true);
      }
      expect((await owner.query(`SELECT quantity, unit_price FROM orders.order_items WHERE order_id=$1`, [o.orderId])).rows[0]).toEqual({ quantity: 1, unit_price: 25000 });
      // druhá vrstva (pro případ budoucí UPDATE politiky pro kupce): guard trigger je nainstalovaný
      const trg = await owner.query(`SELECT tgname FROM pg_trigger WHERE tgrelid='orders.order_items'::regclass AND tgname='trg_order_items_guard_protected' AND tgenabled <> 'D'`);
      expect(trg.rows).toHaveLength(1);
    });
    it('anonymní kontext (bez role) → 42501', async () => {
      const o = await paidOrder();
      const r = await asCtx({}, `UPDATE orders.orders SET status='refunded' WHERE id=$1`, [o.orderId]);
      // anonym řádek pod RLS buď nevidí (0 řádků), nebo ho guard zastaví — nikdy nesmí projít změna
      expect(r.code === '42501' || r.rows === 0).toBe(true);
      expect((await owner.query(`SELECT status FROM orders.orders WHERE id=$1`, [o.orderId])).rows[0].status).toBe('paid');
    });
    it('nechráněné sloupce kupec měnit smí (cancellation_reason, holder_name)', async () => {
      const o = await paidOrder();
      expect(await asCtx(buyerCtx(o.userId), `UPDATE orders.orders SET cancellation_reason='x' WHERE id=$1`, [o.orderId])).toEqual({ code: null, rows: 1 });
      expect(await asCtx(buyerCtx(o.userId), `UPDATE tickets.tickets SET holder_name='Jan' WHERE id=$1`, [o.ticketId])).toEqual({ code: null, rows: 1 });
    });
  });

  // ───────────────────────── B: oprávněné kontexty ─────────────────────────
  describe('B — systém, promotér a platform admin chráněné sloupce měnit smí', () => {
    it('service/system', async () => {
      const o = await paidOrder();
      expect(await asCtx({ 'app.role': 'system' }, `UPDATE orders.orders SET status='refunded' WHERE id=$1`, [o.orderId])).toEqual({ code: null, rows: 1 });
      expect(await asCtx({ 'app.role': 'system' }, `UPDATE tickets.tickets SET status='revoked' WHERE id=$1`, [o.ticketId])).toEqual({ code: null, rows: 1 });
    });
    it('promotér (vlastní akce)', async () => {
      const o = await paidOrder();
      expect(await asCtx({ 'app.current_promoter_id': o.promoterId, 'app.role': 'promoter' },
        `UPDATE orders.orders SET status='refunded' WHERE id=$1`, [o.orderId])).toEqual({ code: null, rows: 1 });
    });
    it('platform admin', async () => {
      const o = await paidOrder();
      expect(await asCtx({ 'app.is_platform_admin': 'true', 'app.role': 'admin' },
        `UPDATE orders.orders SET status='refunded' WHERE id=$1`, [o.orderId])).toEqual({ code: null, rows: 1 });
    });
  });

  // ───────────────────────── C: legitimní cesty kupce ─────────────────────────
  describe('C — legitimní cesty kupce fungují dál', () => {
    const req = async (method: string, path: string, u: { id: string; email: string }, body?: unknown) =>
      new Request(`http://localhost${path}`, {
        method, headers: { 'content-type': 'application/json', authorization: `Bearer ${await sign(u)}`, 'x-real-ip': `10.77.${Math.floor(Math.random() * 250)}.${Math.floor(Math.random() * 250)}` },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
    const status = async (orderId: string) => (await owner.query(`SELECT status FROM orders.orders WHERE id=$1`, [orderId])).rows[0].status;

    it('zrušení objednávky kupcem → cancelled, lístky revoked', async () => {
      const o = await paidOrder();
      const { POST } = await import('@/app/api/buyer/orders/[orderId]/cancel/route');
      const r = await throughMiddleware(await req('POST', `/api/buyer/orders/${o.orderId}/cancel`, { id: o.userId, email: o.email }, { reason: 'guard' }), POST as H, { params: { orderId: o.orderId } });
      expect(r.status, await r.clone().text()).toBe(200);
      expect(await status(o.orderId)).toBe('cancelled');
      expect((await owner.query(`SELECT status FROM tickets.tickets WHERE order_id=$1`, [o.orderId])).rows.map((x) => x.status)).toEqual(['revoked']);
    });

    it('self-refund (povolený pořadatelem) → refunded přes bránu', async () => {
      const o = await paidOrder();
      const pr = await fetch(`${FAKE}/api/payments/payment`, { method: 'POST', headers: { authorization: 'Bearer fake-token-payment-create' }, body: JSON.stringify({ amount: 25000, currency: 'CZK' }) });
      const pid = String(((await pr.json()) as { id: number }).id);
      await fetch(`${FAKE}/_ctl/${pid}`, { method: 'POST', body: JSON.stringify({ state: 'PAID' }) });
      await owner.query(`UPDATE orders.orders SET gopay_payment_id=$2, payment_provider='gopay', paid_at=now() WHERE id=$1`, [o.orderId, pid]);
      await owner.query(`INSERT INTO platform.refund_policies (promoter_id, allow_customer_self_refund) VALUES ($1, true)
                         ON CONFLICT (promoter_id) DO UPDATE SET allow_customer_self_refund = true`, [o.promoterId]);
      const { POST } = await import('@/app/api/buyer/orders/[orderId]/refund/route');
      const r = await throughMiddleware(await req('POST', `/api/buyer/orders/${o.orderId}/refund`, { id: o.userId, email: o.email }, { reason: 'guard self-refund' }), POST as H, { params: { orderId: o.orderId } });
      expect(r.status, await r.clone().text()).toBe(200);
      expect(await status(o.orderId)).toBe('refunded');
      expect((await owner.query(`SELECT status FROM tickets.tickets WHERE order_id=$1`, [o.orderId])).rows.map((x) => x.status)).toEqual(['revoked']);
    });

    it('výměna vstupenky na jiný termín téže produkce', async () => {
      const o = await paidOrder();
      const prod = randomUUID();
      await owner.query(`INSERT INTO catalog.productions (id, promoter_id, title) VALUES ($1,$2,'Guard Produkce')`, [prod, o.promoterId]);
      const target = randomUUID();
      await owner.query(
        `INSERT INTO catalog.events (id, organizer_id, promoter_id, venue_id, title, slug, status, currency, event_type, date_start, production_id, allow_self_service_exchange)
         VALUES ($1,$2,$2,$3,'Reprise',$4,'published','CZK','concert', now() + interval '40 days', $5, true)`,
        [target, o.promoterId, o.venueId, `guard-x-${target.slice(0, 8)}`, prod]);
      await owner.query(`INSERT INTO catalog.ticket_types (id, event_id, name, kind, base_price, total_qty, remaining_qty, visibility, vat_rate_code) VALUES ($1,$2,'Std','standing',25000,10,10,'public','CZ_REDUCED')`, [randomUUID(), target]);
      await owner.query(`UPDATE catalog.events SET production_id=$2, allow_self_service_exchange=true WHERE id=$1`, [o.eventId, prod]);
      const { POST } = await import('@/app/api/buyer/tickets/[ticketId]/exchange/route');
      const r = await throughMiddleware(await req('POST', `/api/buyer/tickets/${o.ticketId}/exchange`, { id: o.userId, email: o.email }, { targetEventId: target }), POST as H, { params: { ticketId: o.ticketId } });
      expect(r.status, await r.clone().text()).toBe(200);
      expect((await owner.query(`SELECT event_id FROM orders.orders WHERE id=$1`, [o.orderId])).rows[0].event_id).toBe(target);
    });

    it('upgrade lístku (zdarma) → ticket_type_id změněn', async () => {
      const o = await paidOrder({ unit: 25000 });
      const vip = randomUUID();
      await owner.query(`INSERT INTO catalog.ticket_types (id, event_id, name, kind, base_price, total_qty, remaining_qty, visibility) VALUES ($1,$2,'Balkon','standing',20000,10,10,'public')`, [vip, o.eventId]);
      const { POST } = await import('@/app/api/my/orders/[id]/upgrade/route');
      const r = await throughMiddleware(await req('POST', `/api/my/orders/${o.orderId}/upgrade`, { id: o.userId, email: o.email }, { ticketId: o.ticketId, newTicketTypeId: vip }), POST as H, { params: { id: o.orderId } });
      expect(r.status, await r.clone().text()).toBe(200);
      expect((await owner.query(`SELECT ticket_type_id FROM tickets.tickets WHERE id=$1`, [o.ticketId])).rows[0].ticket_type_id).toBe(vip);
    });

    it('mobilní platba: payment-intent → order-confirm → paid + lístky', async () => {
      const c = await clone.seed.chain({ remainingQty: 10 });
      // Kolo 7: Stripe (mobil) jen pro akce z doby před mig. 499 — test ověřuje tuto existující cestu.
      await clone.pool.query(`UPDATE catalog.events SET legacy_payment_gateways = TRUE WHERE id=$1`, [c.eventId]);
      const u = await clone.seed.user('gmob');
      const { POST: intent } = await import('@/app/api/mobile/payment-intent/route');
      const r1 = await throughMiddleware(await req('POST', '/api/mobile/payment-intent', u, { eventId: c.eventId, ticketTypeId: c.ticketTypeId, qty: 2 }), intent as H);
      expect(r1.status, await r1.clone().text()).toBe(200);
      const { orderId, paymentIntentId, amount, currency } = (await r1.json()) as { orderId: string; paymentIntentId: string; amount: number; currency: string };
      await fetch(`${FAKE}/_ctl/ext/stripe/${paymentIntentId}`, { method: 'POST', body: JSON.stringify({ id: paymentIntentId, status: 'succeeded', amount, currency: currency.toLowerCase(), metadata: { orderId } }) });
      const { POST: confirm } = await import('@/app/api/mobile/order-confirm/route');
      const r2 = await throughMiddleware(await req('POST', '/api/mobile/order-confirm', u, { paymentIntentId }), confirm as H);
      expect(r2.status, await r2.clone().text()).toBe(200);
      expect(await status(orderId)).toBe('paid');
      expect((await owner.query(`SELECT count(*)::int n FROM tickets.tickets WHERE order_id=$1`, [orderId])).rows[0].n).toBe(2);
    });

    it('uplatnění pojistky → refunded, lístky revoked', async () => {
      const o = await paidOrder();
      await owner.query(`INSERT INTO orders.order_insurance (order_id, premium_amount, premium_pct, currency) VALUES ($1, 1000, 4, 'CZK')`, [o.orderId]);
      const { POST } = await import('@/app/api/buyer/orders/[orderId]/insurance-claim/route');
      const r = await throughMiddleware(await req('POST', `/api/buyer/orders/${o.orderId}/insurance-claim`, { id: o.userId, email: o.email }, { reason: 'nemoc — guard test' }), POST as H, { params: { orderId: o.orderId } });
      expect(r.status, await r.clone().text()).toBe(200);
      expect(await status(o.orderId)).toBe('refunded');
    });
  });
});
