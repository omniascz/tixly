// @vitest-environment node
/**
 * Kolo 2 / krok 2 — V2: funkce rozbité pod rolí `tixly_app` (RLS platí, jako v cílové produkci).
 *
 *   - PDF vstupenek (P7d / X2)       — routa dotazovala bez RLS kontextu → objednávka neviditelná → 404
 *   - storno kupcem (X3)              — `orders.refund_requests` neměl politiku pro kupce → INSERT odmítnut → 500
 *   - POS / pokladna (OP1)            — `INSERT INTO identity.users … RETURNING` padal na SELECT politice
 *   - self-refund kupcem (OP5a)       — `platform.refund_policies` viditelné jen promotérovi → 403 SELF_REFUND_DISABLED
 *
 * Pro každý případ: legitimní uživatel uspěje, cizí je odmítnut a nic se nezmění.
 * Požadavky jdou přes skutečný middleware s reálným JWT; handlery běží pod `tixly_app`
 * (setupLocalEnv → DATABASE_URL = tixly_app). Ground truth čte vlastník (pool fixture).
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { NextRequest } from 'next/server';
import type { Pool } from 'pg';
import { createLocalClone, hasLocalDb, type LocalClone } from './helpers/local-fixture';
import { throughMiddleware } from './helpers/through-middleware';

const run = describe.skipIf(!hasLocalDb);
const FAKE = 'http://localhost:3998';
type H<C = unknown> = (r: NextRequest, ctx: C) => Promise<Response>;

function req(method: string, path: string, token?: string, body?: unknown): Request {
  return new Request(`http://localhost${path}`, {
    method,
    headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

run('Krok 2 — V2 pod tixly_app: legitimní uspěje, cizí odmítnut', () => {
  let clone: LocalClone;
  let pool: Pool;
  let sign: (u: { id: string; email: string }, memberships?: Array<{ promoterId: string }>) => Promise<string>;

  beforeAll(async () => {
    clone = await createLocalClone();
    pool = clone.pool;
    const { signAccessToken } = await import('@/lib/auth');
    sign = (u, memberships = []) => signAccessToken({ id: u.id, email: u.email, name: 'T' } as never, {
      isPlatformAdmin: false,
      promoterMemberships: memberships.map((m) => ({ promoterId: m.promoterId, status: 'active', role: 'owner' }) as never),
    });
  }, 120_000);
  afterAll(async () => { await clone?.cleanup(); }, 30_000);

  /** Zaplacená objednávka s vystavenými vstupenkami (produkční issuer) + platba ve fake GoPay. */
  async function paidOrder(opts: { basePrice?: number } = {}) {
    const fc = await clone.seed.fullChain({ totalQty: 20, remainingQty: 19, basePrice: opts.basePrice ?? 50000 });
    await pool.query(`UPDATE catalog.events SET qr_policy='static_allowed' WHERE id=$1`, [fc.eventId]);
    await pool.query(`UPDATE platform.promoters SET status='active' WHERE id=$1`, [fc.promoterId]).catch(() => {});
    const total = (await pool.query<{ t: number }>(`SELECT total_amount t FROM orders.orders WHERE id=$1`, [fc.orderId])).rows[0].t;
    const p = await (await fetch(`${FAKE}/api/payments/payment`, { method: 'POST', body: JSON.stringify({ amount: total, currency: 'CZK' }) })).json() as { id: number };
    await fetch(`${FAKE}/_ctl/${p.id}`, { method: 'POST', body: JSON.stringify({ state: 'PAID' }) });
    await pool.query(`UPDATE orders.orders SET gopay_payment_id=$2, payment_provider='gopay', paid_at=now() WHERE id=$1`, [fc.orderId, String(p.id)]);
    const owner = (await pool.query<{ email: string }>(`SELECT email FROM identity.users WHERE id=$1`, [fc.userId])).rows[0];
    return { ...fc, gopayId: String(p.id), ownerToken: await sign({ id: fc.userId, email: owner.email }) };
  }
  async function foreignBuyerToken() {
    const u = await clone.seed.user('foreign', 'Cizí');
    return sign(u);
  }
  const orderStatus = async (id: string) => (await pool.query<{ s: string }>(`SELECT status s FROM orders.orders WHERE id=$1`, [id])).rows[0].s;
  const ticketStatuses = async (id: string) => (await pool.query<{ s: string }>(`SELECT status s FROM tickets.tickets WHERE order_id=$1 ORDER BY id`, [id])).rows.map((r) => r.s);
  const remaining = async (tt: string) => (await pool.query<{ r: number }>(`SELECT remaining_qty r FROM catalog.ticket_types WHERE id=$1`, [tt])).rows[0].r;

  // ───────────── PDF vstupenek (P7d / X2) ─────────────
  it('PDF: vlastník stáhne PDF; cizí kupec ani anonym ne', async () => {
    const o = await paidOrder();
    const { GET } = await import('@/app/api/buyer/orders/[orderId]/ticket-pdf/route');
    const h = GET as H<{ params: { orderId: string } }>;
    const ctx = { params: { orderId: o.orderId } };
    const own = await throughMiddleware(req('GET', `/api/buyer/orders/${o.orderId}/ticket-pdf`, o.ownerToken), h, ctx);
    const body = Buffer.from(await own.arrayBuffer());
    expect(own.status, body.toString('utf8').slice(0, 200)).toBe(200);
    expect(body.subarray(0, 4).toString()).toBe('%PDF');
    const foreign = await throughMiddleware(req('GET', `/api/buyer/orders/${o.orderId}/ticket-pdf`, await foreignBuyerToken()), h, ctx);
    expect([403, 404]).toContain(foreign.status);
    const anon = await throughMiddleware(req('GET', `/api/buyer/orders/${o.orderId}/ticket-pdf`), h, ctx);
    expect(anon.status).toBe(401);
    // PDF routa nesmí vystavovat vstupenky (jen číst): počet beze změny
    expect((await ticketStatuses(o.orderId)).length).toBe(1);
  });

  // ───────────── storno kupcem (X3) ─────────────
  it('storno: vlastník stornuje zaplacenou objednávku (cancelled, vstupenky revoked, refund_request, kapacita zpět); cizí ne', async () => {
    const o = await paidOrder();
    const { POST } = await import('@/app/api/buyer/orders/[orderId]/cancel/route');
    const h = POST as H<{ params: { orderId: string } }>;
    const ctx = { params: { orderId: o.orderId } };

    const remBefore = await remaining(o.ticketTypeId);
    const foreign = await throughMiddleware(req('POST', `/api/buyer/orders/${o.orderId}/cancel`, await foreignBuyerToken(), { reason: 'x' }), h, ctx);
    expect([403, 404]).toContain(foreign.status);
    expect(await orderStatus(o.orderId)).toBe('paid');
    expect(await ticketStatuses(o.orderId)).toEqual(['valid']);

    const own = await throughMiddleware(req('POST', `/api/buyer/orders/${o.orderId}/cancel`, o.ownerToken, { reason: 'kolo2' }), h, ctx);
    expect(own.status, await own.clone().text()).toBe(200);
    expect(await orderStatus(o.orderId)).toBe('cancelled');
    expect(await ticketStatuses(o.orderId)).toEqual(['revoked']);
    const rr = await pool.query<{ user_id: string; status: string }>(`SELECT user_id, status FROM orders.refund_requests WHERE order_id=$1`, [o.orderId]);
    expect(rr.rows.length).toBe(1);
    expect(rr.rows[0].user_id).toBe(o.userId);
    expect(await remaining(o.ticketTypeId), 'kapacita vrácena').toBe(remBefore + 1);
  });

  // ───────────── POS / pokladna (OP1) ─────────────
  it('POS: obsluha pořadatele prodá na pokladně (paid + vstupenky); cizí pořadatel na cizí akci ne', async () => {
    const c = await clone.seed.chain({ totalQty: 20, remainingQty: 20, basePrice: 30000 });
    await pool.query(`UPDATE platform.promoters SET status='active' WHERE id=$1`, [c.promoterId]).catch(() => {});
    const staff = (await pool.query<{ email: string }>(`SELECT email FROM identity.users WHERE id=$1`, [c.adminUserId])).rows[0];
    const staffToken = await sign({ id: c.adminUserId, email: staff.email }, [{ promoterId: c.promoterId }]);
    const other = await clone.seed.chain();
    await pool.query(`UPDATE platform.promoters SET status='active' WHERE id=$1`, [other.promoterId]).catch(() => {});
    const otherStaff = (await pool.query<{ email: string }>(`SELECT email FROM identity.users WHERE id=$1`, [other.adminUserId])).rows[0];
    const otherToken = await sign({ id: other.adminUserId, email: otherStaff.email }, [{ promoterId: other.promoterId }]);
    const { POST } = await import('@/app/api/admin/pos/sale/route');
    const h = POST as H;
    const body = { eventId: c.eventId, ticketTypeId: c.ticketTypeId, quantity: 2, buyerName: 'Pokladní kupec', paymentMethod: 'cash' };
    const countOrders = async () => (await pool.query<{ n: number }>(`SELECT count(*)::int n FROM orders.orders WHERE event_id=$1`, [c.eventId])).rows[0].n;

    const foreign = await throughMiddleware(req('POST', '/api/admin/pos/sale', otherToken, body), h, undefined);
    expect([403, 404]).toContain(foreign.status);
    expect(await countOrders()).toBe(0);

    const own = await throughMiddleware(req('POST', '/api/admin/pos/sale', staffToken, body), h, undefined);
    const j = await own.clone().json().catch(() => ({})) as { orderId?: string };
    expect(own.status, JSON.stringify(j)).toBe(200);
    expect(j.orderId).toBeTruthy();
    expect(await orderStatus(j.orderId!)).toBe('paid');
    expect(await ticketStatuses(j.orderId!)).toEqual(['valid', 'valid']);
    expect(await remaining(c.ticketTypeId)).toBe(18);
  });

  // ───────────── self-refund (OP5a) ─────────────
  it('self-refund: po povolení pořadatelem vlastník refunduje (brána zavolána); cizí ne', async () => {
    const o = await paidOrder();
    await pool.query(`INSERT INTO platform.refund_policies (promoter_id, allow_customer_self_refund) VALUES ($1, true)
                      ON CONFLICT (promoter_id) DO UPDATE SET allow_customer_self_refund = true`, [o.promoterId]);
    const { POST } = await import('@/app/api/buyer/orders/[orderId]/refund/route');
    const h = POST as H<{ params: { orderId: string } }>;
    const ctx = { params: { orderId: o.orderId } };
    const refundCalls = async () => ((await (await fetch(`${FAKE}/_ctl/refund-calls`)).json()) as Array<{ path: string }>)
      .filter((c) => c.path === `/api/payments/payment/${o.gopayId}/refund`).length;

    const foreign = await throughMiddleware(req('POST', `/api/buyer/orders/${o.orderId}/refund`, await foreignBuyerToken(), { reason: 'x' }), h, ctx);
    expect([403, 404]).toContain(foreign.status);
    expect(await orderStatus(o.orderId)).toBe('paid');
    expect(await refundCalls()).toBe(0);

    const own = await throughMiddleware(req('POST', `/api/buyer/orders/${o.orderId}/refund`, o.ownerToken, { reason: 'kolo2 self-refund' }), h, ctx);
    expect(own.status, await own.clone().text()).toBe(200);
    expect(await orderStatus(o.orderId)).toBe('refunded');
    expect(await ticketStatuses(o.orderId)).toEqual(['revoked']);
    expect(await refundCalls(), 'brána zavolána právě jednou').toBe(1);
  });

  // ───────────── DB vrstva: politiky pouští právě legitimní přístup ─────────────
  it('DB (tixly_app): refund_policies vidí jen kupec, který u pořadatele koupil; refund_request nelze založit na cizí objednávku', async () => {
    const o = await paidOrder();
    await pool.query(`INSERT INTO platform.refund_policies (promoter_id, allow_customer_self_refund) VALUES ($1, true)
                      ON CONFLICT (promoter_id) DO UPDATE SET allow_customer_self_refund = true`, [o.promoterId]);
    const foreign = await clone.seed.user('foreign-db', 'Cizí');
    const { Pool: PgPool } = await import('pg');
    const app = new PgPool({ connectionString: process.env.FIX_DB_APP_URL ?? 'postgresql://tixly_app:fixapp@localhost:55632/e2e', max: 1 });
    try {
      const asUser = async <T>(uid: string, fn: (q: (s: string, p?: unknown[]) => Promise<{ rows: T[]; rowCount: number | null }>) => Promise<unknown>) => {
        const cl = await app.connect();
        try {
          await cl.query('BEGIN');
          await cl.query(`SELECT set_config('app.current_user_id',$1,true), set_config('app.role','user',true)`, [uid]);
          return await fn((s, p) => cl.query(s, p) as never);
        } finally { await cl.query('ROLLBACK').catch(() => {}); cl.release(); }
      };
      const seen = (uid: string) => asUser<{ n: number }>(uid, async (q) => (await q(`SELECT count(*)::int n FROM platform.refund_policies WHERE promoter_id=$1`, [o.promoterId])).rows[0].n);
      expect(await seen(o.userId), 'kupec, který koupil').toBe(1);
      expect(await seen(foreign.id), 'kupec bez nákupu u pořadatele').toBe(0);
      const ins = await asUser(foreign.id, async (q) => q(
        `INSERT INTO orders.refund_requests (order_id, user_id, refunded_halire, reason, status, promoter_id) VALUES ($1,$2,1,'x','pending',$3)`,
        [o.orderId, foreign.id, o.promoterId]).then(() => 'inserted', (e: Error) => e.message));
      expect(ins).toMatch(/row-level security/);
      const upd = await asUser(o.userId, async (q) => q(`UPDATE platform.refund_policies SET allow_customer_self_refund=false WHERE promoter_id=$1`, [o.promoterId]).then((r) => r.rowCount));
      expect(upd, 'kupec politiku pořadatele nezmění').toBe(0);
    } finally { await app.end(); }
  });
});
