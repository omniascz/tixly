// @vitest-environment node
/**
 * 25. 11. 2026 — opravy známých chyb z reportů kol (ROUND7, ROUND20, ROUND23, FINDINGS):
 *   A. permanentka: nákup dřív 500 (holder_user_id), použití četlo neexistující sloupce a šlo i bez zaplacení
 *   B. white-label API: vždy 401 (RLS na whitelabel_tenants), za tím 42703 (tt.status, default_payment_provider) a NULL user_id
 *   C. modular pass: platba se nezakládala (vždy /mock-gopay), kapacita se neodečítala, výběr dní×zón mimo transakci
 *   D. datum v Praze, ne v UTC: export Pohoda (DUZP) a kalendář termínů
 *
 * Běží jen s FIX_E2E=1 proti DB z migrací pod tixly_app a se simulátorem GoPay na :3998 (with_gopay.sh).
 */
import { createHash, randomBytes, randomUUID } from 'crypto';
import type { NextRequest } from 'next/server';
import type { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createLocalClone, hasLocalDb, type LocalClone } from './helpers/local-fixture';
import { throughMiddleware } from './helpers/through-middleware';

const run = describe.skipIf(!hasLocalDb);
const FAKE = 'http://localhost:3998';
type H = (r: NextRequest, ctx?: unknown) => Promise<Response>;

run('25. 11. — známé chyby (permanentka, white-label, modular pass, datum v Praze)', () => {
  let clone: LocalClone;
  let pool: Pool;
  beforeAll(async () => {
    clone = await createLocalClone();
    pool = clone.pool;
    (await import('@/lib/payment/gopay-real'))._resetGopayCacheForTests();
  }, 120_000);
  afterAll(async () => { await clone?.cleanup(); }, 30_000);

  const call = async (method: string, url: string, mod: () => Promise<Record<string, unknown>>, body?: unknown,
    opts: { ctx?: unknown; headers?: Record<string, string> } = {}) => {
    const m = await mod();
    return throughMiddleware(new Request(`http://localhost${url}`, {
      method, headers: { 'content-type': 'application/json', origin: 'http://localhost', ...opts.headers },
      body: body === undefined ? undefined : JSON.stringify(body),
    }), m[method] as H, opts.ctx);
  };
  /** Opakuje dotaz, dokud nevrátí očekávanou hodnotu (vitest této verze nemá expect.poll). */
  const until = (fn: () => Promise<unknown>, o: { timeout: number }) => ({
    async toBe(want: unknown) {
      const end = Date.now() + o.timeout; let got: unknown;
      while (Date.now() < end) { got = await fn(); if (got === want) return; await new Promise((r) => setTimeout(r, 300)); }
      expect(got).toBe(want);
    },
  });
  const one = async <T>(sql: string, p: unknown[]) => (await pool.query(sql, p)).rows[0] as T;
  /** Simulátor potvrdí platbu a GoPay webhook ji připíše (stejně jako u skutečné brány). */
  async function pay(orderId: string): Promise<void> {
    const o = await one<{ pid: string; amt: number }>(`SELECT gopay_payment_id pid, total_amount amt FROM orders.orders WHERE id=$1`, [orderId]);
    await fetch(`${FAKE}/_ctl/${o.pid}`, { method: 'POST', body: JSON.stringify({ state: 'PAID', amount: o.amt }) });
    const { GET } = await import('@/app/api/payments/gopay/webhook/route');
    const r = await throughMiddleware(new Request(`http://localhost/api/payments/gopay/webhook?id=${o.pid}`), GET as H);
    expect(r.status, await r.clone().text()).toBeLessThan(500);
    await until(async () => (await one<{ s: string }>(`SELECT status s FROM orders.orders WHERE id=$1`, [orderId])).s, { timeout: 20_000 }).toBe('paid');
  }
  async function adminToken(promoterId: string, userId: string): Promise<string> {
    const { signAccessToken } = await import('@/lib/auth');
    const email = (await one<{ email: string }>(`SELECT email FROM identity.users WHERE id=$1`, [userId])).email;
    return signAccessToken({ id: userId, email, name: 'U' } as never, {
      isPlatformAdmin: false, promoterMemberships: [{ promoterId, slug: 'x', name: 'x', status: 'active', role: 'owner' }],
    } as never);
  }

  it('A — permanentka: nákup 201, před zaplacením nejde použít, limit na kupce, po zaplacení vstupenka držiteli', async () => {
    const c = await clone.seed.chain({ basePrice: 0, remainingQty: 10 });
    const productId = (await one<{ id: string }>(
      `INSERT INTO catalog.season_pass_products (promoter_id, title, price_halire, total_uses, valid_until, max_per_buyer)
       VALUES ($1, 'Abonmá DEMO', 50000, 3, now() + interval '60 days', 1) RETURNING id`, [c.promoterId])).id;
    const email = `pass-${randomUUID().slice(0, 8)}@x.test`;
    const mod = () => import('@/app/api/season-passes/route');
    const r = await call('POST', '/api/season-passes', mod, { productId, buyerEmail: email, buyerName: 'Držitel' });
    const body = await r.json() as { passToken: string; orderId: string; gatewayUrl: string };
    expect(r.status, JSON.stringify(body)).toBe(201);
    expect(body.gatewayUrl.startsWith(FAKE)).toBe(true);

    const tokenMod = () => import('@/app/api/season-passes/[passToken]/route');
    const ctx = { params: Promise.resolve({ passToken: body.passToken }) };
    const g1 = await (await call('GET', `/api/season-passes/${body.passToken}`, tokenMod, undefined, { ctx })).json() as { pass: { status: string } };
    expect(g1.pass.status).toBe('pending_payment');
    const early = await call('POST', `/api/season-passes/${body.passToken}`, tokenMod, { eventId: c.eventId }, { ctx });
    expect(early.status).toBe(409);
    expect((await early.json() as { error: string }).error).toBe('PASS_NOT_ACTIVE');

    const second = await call('POST', '/api/season-passes', mod, { productId, buyerEmail: email });
    expect(second.status).toBe(409);
    expect((await second.json() as { error: string }).error).toBe('MAX_PER_BUYER_REACHED');

    await pay(body.orderId);
    const g2 = await (await call('GET', `/api/season-passes/${body.passToken}`, tokenMod, undefined, { ctx })).json() as { pass: { status: string } };
    expect(g2.pass.status).toBe('active');
    const use = await call('POST', `/api/season-passes/${body.passToken}`, tokenMod, { eventId: c.eventId }, { ctx });
    expect(use.status, await use.clone().text()).toBe(200);
    const buyer = await one<{ user_id: string }>(`SELECT user_id FROM orders.orders WHERE id=$1`, [body.orderId]);
    const t = await one<{ owner_id: string; n: number }>(
      `SELECT t.owner_id, sp.uses_remaining n FROM orders.season_pass_uses u JOIN tickets.tickets t ON t.id = u.ticket_id
        JOIN orders.season_passes sp ON sp.id = u.pass_id WHERE sp.pass_token = $1`, [body.passToken]);
    expect(t.owner_id).toBe(buyer.user_id);
    expect(t.n).toBe(2);
  }, 120_000);

  it('B — white-label: platný klíč → 201, objednávka na zákazníka, kapacita −2; bez klíče 401', async () => {
    const c = await clone.seed.chain({ basePrice: 30000, remainingQty: 10, totalQty: 10 });
    const key = `wl_test_${randomBytes(16).toString('hex')}`;
    await pool.query(
      `INSERT INTO platform.whitelabel_tenants (name, slug, api_key_hash, key_prefix) VALUES ('Partner', $1, $2, 'wl_test_')`,
      [`partner-${randomUUID().slice(0, 8)}`, createHash('sha256').update(key).digest('hex')]);
    const mod = () => import('@/app/api/v1/wl/orders/route');
    const email = `wl-${randomUUID().slice(0, 8)}@x.test`;
    const payload = { eventId: c.eventId, tickets: [{ ticketTypeId: c.ticketTypeId, quantity: 2 }], customerEmail: email, paymentMethod: 'gopay' };
    expect((await call('POST', '/api/v1/wl/orders', mod, payload)).status).toBe(401);
    const r = await call('POST', '/api/v1/wl/orders', mod, payload, { headers: { authorization: `Bearer ${key}` } });
    const body = await r.json() as { orderId: string; paymentUrl: string; totalAmount: number };
    expect(r.status, JSON.stringify(body)).toBe(201);
    expect(body.totalAmount).toBe(60000);
    expect(body.paymentUrl.startsWith(FAKE)).toBe(true);
    const o = await one<{ email: string; provider: string; left: number }>(
      `SELECT u.email, o.payment_provider provider, tt.remaining_qty "left" FROM orders.orders o JOIN identity.users u ON u.id = o.user_id
         JOIN catalog.ticket_types tt ON tt.id = $2 WHERE o.id = $1`, [body.orderId, c.ticketTypeId]);
    expect(o).toEqual({ email, provider: 'gopay', left: 8 });

    // events: jen promoterId (dřív $6 bez $5 → 500), akce bez inscenace (dřív JOIN ji vyřadil), odkaz na existující stránku
    const ev = () => import('@/app/api/v1/wl/events/route');
    const lr = await call('GET', `/api/v1/wl/events?promoterId=${c.promoterId}`, ev, undefined, { headers: { authorization: `Bearer ${key}` } });
    const list = await lr.json() as { events: Array<{ id: string; slug: string; checkoutUrl: string }> };
    expect(lr.status, JSON.stringify(list)).toBe(200);
    const mine = list.events.find((e) => e.id === c.eventId);
    expect(mine?.checkoutUrl).toMatch(new RegExp(`/cs/events/${mine?.slug}\\?brand=`));
  }, 60_000);

  it('C — modular pass: platba přes bránu, cena, kapacita, výběr dní×zón na vstupence; vyprodáno 409', async () => {
    const c = await clone.seed.chain({ basePrice: 10000, remainingQty: 5, totalQty: 5 });
    await pool.query(
      `INSERT INTO catalog.ticket_modular_pricing (ticket_type_id, per_day_price_minor, per_zone_surcharge_minor, min_days, min_zones)
       VALUES ($1, 5000, 2000, 1, 1)`, [c.ticketTypeId]);
    const day = async (i: number) => (await one<{ id: string }>(
      `INSERT INTO catalog.event_days (event_id, day_index, starts_at, ends_at)
       VALUES ($1, $2, now() + make_interval(days => 30 + $2), now() + make_interval(days => 30 + $2, hours => 8)) RETURNING id`, [c.eventId, i])).id;
    const d1 = await day(1); const d2 = await day(2);
    const z = (await one<{ id: string }>(`INSERT INTO catalog.event_zones (event_id, name) VALUES ($1, 'Hlavní') RETURNING id`, [c.eventId])).id;
    const mod = () => import('@/app/api/buyer/modular-pass/checkout/route');
    const payload = { eventId: c.eventId, ticketTypeId: c.ticketTypeId, selections: [{ dayId: d1, zoneId: z }, { dayId: d2, zoneId: z }],
      buyerEmail: `mod-${randomUUID().slice(0, 8)}@x.test`, buyerName: 'Festivalák', paymentMethod: 'gopay' };
    const r = await call('POST', '/api/buyer/modular-pass/checkout', mod, payload);
    const body = await r.json() as { orderId: string; gatewayUrl: string; totalAmount: number };
    expect(r.status, JSON.stringify(body)).toBe(200);
    expect(body.totalAmount).toBe(10000 + 2 * 5000 + 2000);
    expect(body.gatewayUrl.startsWith(FAKE)).toBe(true);
    expect((await one<{ n: number }>(`SELECT remaining_qty n FROM catalog.ticket_types WHERE id=$1`, [c.ticketTypeId])).n).toBe(4);
    expect((await one<{ n: number }>(`SELECT count(*)::int n FROM marketing.modular_pass_pending_selections WHERE order_id=$1`, [body.orderId])).n).toBe(1);

    await pay(body.orderId);
    await until(async () => (await one<{ n: number }>(
      `SELECT count(*)::int n FROM tickets.ticket_modular_access a JOIN tickets.tickets t ON t.id = a.ticket_id WHERE t.order_id=$1`,
      [body.orderId])).n, { timeout: 20_000 }).toBe(2);

    await pool.query(`UPDATE catalog.ticket_types SET remaining_qty = 0 WHERE id=$1`, [c.ticketTypeId]);
    const sold = await call('POST', '/api/buyer/modular-pass/checkout', mod, { ...payload, buyerEmail: `mod2-${randomUUID().slice(0, 8)}@x.test` });
    expect(sold.status).toBe(409);
  }, 120_000);

  it('D — datum v Praze: platba 31. 10. 23:30 UTC patří do Pohody za listopad s datem 2026-11-01; termín 22:30 UTC je v kalendáři další den', async () => {
    const c = await clone.seed.chain();
    const o = await clone.seed.order(c, { status: 'paid' });
    await pool.query(`UPDATE orders.orders SET paid_at = '2026-10-31T23:30:00Z' WHERE id=$1`, [o.orderId]);
    await pool.query(`UPDATE catalog.events SET date_start = '2027-03-14T23:30:00Z' WHERE id=$1`, [c.eventId]);
    const tok = await adminToken(c.promoterId, c.adminUserId);
    const auth = { headers: { authorization: `Bearer ${tok}` } };
    const pohoda = () => import('@/app/api/admin/reports/pohoda/route');
    const nov = await (await call('GET', '/api/admin/reports/pohoda?month=2026-11', pohoda, undefined, auth)).text();
    expect(nov).toContain(o.orderId.slice(0, 8));
    expect(nov).toContain('<inv:dateTax>2026-11-01</inv:dateTax>');
    const oct = await (await call('GET', '/api/admin/reports/pohoda?month=2026-10', pohoda, undefined, auth)).text();
    expect(oct).not.toContain(o.orderId.slice(0, 8));

    const holds = () => import('@/app/api/admin/date-holds/route');
    const cal = await (await call('GET', '/api/admin/date-holds?from=2027-03-15&to=2027-03-15', holds, undefined, auth)).json() as { events: Array<{ id: string; date: string }> };
    expect(cal.events.find((e) => e.id === c.eventId)?.date).toBe('2027-03-15');
  }, 60_000);
});
