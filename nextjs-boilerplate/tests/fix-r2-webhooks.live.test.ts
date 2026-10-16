// @vitest-environment node
/**
 * Kolo 2 / krok 1 — platební a další příchozí webhooky musí být fail-closed.
 *
 * Invariant pro KAŽDOU webhook routu:
 *   bez podpisu / se špatným podpisem / s chybějícím tajemstvím v env / v neznámém formátu
 *   → 4xx a NIC se nezmění (objednávka pending, žádná vstupenka, výplata ani smlouva beze změny).
 * Před označením `paid` se stav platby ověří dotazem na API brány (jako u GoPay) — samotný
 * (i podepsaný) obsah notifikace nestačí, a nulová/chybějící částka nikdy nepokrývá cenu.
 *
 * Brány simuluje `tests/helpers/fake-gopay.mjs` (:3998). Pojistka: jakýkoli fetch mimo
 * localhost test okamžitě shodí — nikdy se nevolá skutečná brána.
 * Požadavky jdou přes skutečný middleware (helpers/through-middleware).
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { NextRequest } from 'next/server';
import type { Pool } from 'pg';
import { createHmac, generateKeyPairSync, randomUUID, sign as rsaSign } from 'crypto';
import { createLocalClone, hasLocalDb, type LocalClone } from './helpers/local-fixture';
import { throughMiddleware } from './helpers/through-middleware';

const run = describe.skipIf(!hasLocalDb);
const FAKE = 'http://localhost:3998';
type H = (r: NextRequest) => Promise<Response>;

const ctl = (prov: string, id: string, obj: unknown) =>
  fetch(`${FAKE}/_ctl/ext/${prov}/${encodeURIComponent(id)}`, { method: 'POST', body: JSON.stringify(obj) });
const gopayCtl = (id: string, obj: unknown) => fetch(`${FAKE}/_ctl/${id}`, { method: 'POST', body: JSON.stringify(obj) });

/** Zahodí cache konfigurací bran (čtou env jen jednou). */
async function resetGatewayCaches(): Promise<void> {
  (await import('@/lib/payment/gopay-real'))._resetGopayCacheForTests();
  (await import('@/lib/payment/comgate'))._resetComGateCacheForTests();
  (await import('@/lib/payment/triplea'))._resetTripleACacheForTests();
}

/** Dočasně nastaví/odstraní env proměnné (undefined = smazat) jen pro běh fn. */
async function withEnv<T>(vars: Record<string, string | undefined>, fn: () => Promise<T>): Promise<T> {
  const saved: Record<string, string | undefined> = {};
  for (const [k, v] of Object.entries(vars)) {
    saved[k] = process.env[k];
    if (v === undefined) delete process.env[k]; else process.env[k] = v;
  }
  await resetGatewayCaches();
  try { return await fn(); } finally {
    for (const [k, v] of Object.entries(saved)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
    await resetGatewayCaches();
  }
}

const post = (path: string, body: string, headers: Record<string, string> = {}) =>
  new Request(`http://localhost${path}`, { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body });
const get = (path: string) => new Request(`http://localhost${path}`, { method: 'GET' });

// konfigurace bran (všechny míří na simulátor)
const BASE_ENV = {
  PAYPAL_CLIENT_ID: 'fix-pp', PAYPAL_CLIENT_SECRET: 'fix-pp-secret', PAYPAL_WEBHOOK_ID: 'WH-FIX',
  PAYPAL_API_BASE_URL: `${FAKE}/paypal`,
  STRIPE_SECRET_KEY: 'sk_test_fix', STRIPE_WEBHOOK_SECRET: 'whsec_fix', STRIPE_API_BASE_URL: `${FAKE}/stripe`,
  TRIPLEA_CLIENT_ID: 'fix-ta', TRIPLEA_CLIENT_SECRET: 'fix-ta-secret', TRIPLEA_API_ID: 'fix-api', TRIPLEA_NOTIFY_SECRET: 'fix-notify',
  TRIPLEA_API_BASE_URL: `${FAKE}/triplea`,
  WISE_API_KEY: 'fix-wise', WISE_PROFILE_ID: '1', WISE_API_BASE_URL: `${FAKE}/wise`,
  MOLLIE_API_KEY: 'test_fix', MOLLIE_API_BASE_URL: `${FAKE}/mollie/v2`,
  PLUXEE_CALLBACK_SECRET: 'fix-pluxee',
};

run('Krok 1 — webhooky fail-closed + ověření stavu u brány', () => {
  let clone: LocalClone;
  let pool: Pool;
  const realFetch = globalThis.fetch;
  const { publicKey: wisePub, privateKey: wisePriv } = generateKeyPairSync('rsa', { modulusLength: 2048 });
  const wisePem = wisePub.export({ type: 'spki', format: 'pem' }).toString();

  beforeAll(async () => {
    clone = await createLocalClone();
    pool = clone.pool;
    for (const [k, v] of Object.entries(BASE_ENV)) process.env[k] = v;
    process.env.WISE_WEBHOOK_PUBLIC_KEY = wisePem;
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const u = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url);
      if (u.hostname !== 'localhost' && u.hostname !== '127.0.0.1') {
        throw new Error(`TEST GUARD: pokus o spojení na skutečnou službu ${u.origin}`);
      }
      return realFetch(input, init);
    }) as typeof fetch;
  }, 120_000);
  afterAll(async () => { globalThis.fetch = realFetch; await clone?.cleanup(); }, 30_000);
  beforeEach(async () => { await resetGatewayCaches(); });

  async function pendingOrder(provider: string, paymentId: string, total = 50000): Promise<string> {
    const c = await clone.seed.chain({ basePrice: total });
    const o = await clone.seed.order(c, { status: 'pending', unitPrice: total });
    await pool.query(`UPDATE orders.orders SET gopay_payment_id=$2, payment_provider=$3 WHERE id=$1`, [o.orderId, paymentId, provider]);
    return o.orderId;
  }
  const orderState = async (id: string) => {
    const s = (await pool.query<{ status: string }>(`SELECT status FROM orders.orders WHERE id=$1`, [id])).rows[0].status;
    const t = (await pool.query<{ n: number }>(`SELECT count(*)::int n FROM tickets.tickets WHERE order_id=$1`, [id])).rows[0].n;
    return { status: s, tickets: t };
  };
  const expectUntouched = async (res: Response, orderId: string, label: string) => {
    expect(res.status, `${label}: HTTP`).toBeGreaterThanOrEqual(400);
    expect(res.status, `${label}: HTTP`).toBeLessThan(500);
    expect(await orderState(orderId), `${label}: objednávka`).toEqual({ status: 'pending', tickets: 0 });
  };

  // ───────────────────────── PayPal ─────────────────────────
  describe('PayPal', () => {
    const hook = async () => (await import('@/app/api/payments/paypal/webhook/route')).POST as H;
    const ev = (ppOrder: string, value = '500.00') => JSON.stringify({
      id: `WH-${randomUUID()}`, event_type: 'PAYMENT.CAPTURE.COMPLETED',
      resource: { id: `CAP-${randomUUID().slice(0, 8)}`, status: 'COMPLETED', amount: { value, currency_code: 'CZK' },
        supplementary_data: { related_ids: { order_id: ppOrder } } },
    });
    const sigHeaders = (sig: string) => ({
      'paypal-transmission-id': randomUUID(), 'paypal-transmission-time': new Date().toISOString(),
      'paypal-cert-url': 'https://api.paypal.com/cert', 'paypal-auth-algo': 'SHA256withRSA', 'paypal-transmission-sig': sig,
    });
    const paypalOrder = (status: string, value: string) => ({ id: 'x', status, purchase_units: [{ payments: { captures: [{ id: 'CAP', status: 'COMPLETED', amount: { value, currency_code: 'CZK' } }] } }] });

    it('chybějící PAYPAL_WEBHOOK_ID → 4xx, nic se nezmění', async () => {
      const pp = `PP-${randomUUID()}`; const oid = await pendingOrder('paypal', pp);
      await ctl('paypal', pp, paypalOrder('COMPLETED', '500.00'));
      const res = await withEnv({ PAYPAL_WEBHOOK_ID: undefined }, async () => throughMiddleware(post('/api/payments/paypal/webhook', ev(pp), sigHeaders('valid-sig')), await hook()));
      await expectUntouched(res, oid, 'paypal bez WEBHOOK_ID');
    });
    it('bez podpisu / se špatným podpisem → 4xx', async () => {
      const pp = `PP-${randomUUID()}`; const oid = await pendingOrder('paypal', pp);
      await ctl('paypal', pp, paypalOrder('COMPLETED', '500.00'));
      await expectUntouched(await throughMiddleware(post('/api/payments/paypal/webhook', ev(pp)), await hook()), oid, 'paypal bez podpisu');
      await expectUntouched(await throughMiddleware(post('/api/payments/paypal/webhook', ev(pp), sigHeaders('forged')), await hook()), oid, 'paypal špatný podpis');
    });
    it('neznámý formát (platný podpis, chybí resource) → 4xx', async () => {
      const pp = `PP-${randomUUID()}`; const oid = await pendingOrder('paypal', pp);
      const res = await throughMiddleware(post('/api/payments/paypal/webhook', JSON.stringify({ event_type: 'PAYMENT.CAPTURE.COMPLETED' }), sigHeaders('valid-sig')), await hook());
      await expectUntouched(res, oid, 'paypal neznámý formát');
    });
    it('platný podpis, ale API brány neříká COMPLETED / plnou částku → nezaplaceno', async () => {
      const pp = `PP-${randomUUID()}`; const oid = await pendingOrder('paypal', pp);
      await ctl('paypal', pp, paypalOrder('APPROVED', '500.00'));
      const r1 = await throughMiddleware(post('/api/payments/paypal/webhook', ev(pp), sigHeaders('valid-sig')), await hook());
      expect((await orderState(oid)).status, `API stav APPROVED (HTTP ${r1.status})`).toBe('pending');
      await ctl('paypal', pp, paypalOrder('COMPLETED', '1.00'));
      const r2 = await throughMiddleware(post('/api/payments/paypal/webhook', ev(pp), sigHeaders('valid-sig')), await hook());
      expect((await orderState(oid)).status, `API částka 1 Kč (HTTP ${r2.status})`).toBe('pending');
    });
    it('legitimní: platný podpis + API COMPLETED s plnou částkou → paid', async () => {
      const pp = `PP-${randomUUID()}`; const oid = await pendingOrder('paypal', pp);
      await ctl('paypal', pp, paypalOrder('COMPLETED', '500.00'));
      const res = await throughMiddleware(post('/api/payments/paypal/webhook', ev(pp), sigHeaders('valid-sig')), await hook());
      expect(res.status).toBe(200);
      expect((await orderState(oid)).status).toBe('paid');
    });
  });

  // ───────────────────────── Wise ─────────────────────────
  describe('Wise (výplaty)', () => {
    const hook = async () => (await import('@/app/api/payments/wise/webhook/route')).POST as H;
    async function payout(transferId: string): Promise<string> {
      const c = await clone.seed.chain();
      return (await pool.query<{ id: string }>(
        `INSERT INTO platform.payouts (promoter_id, period_from, period_to, net_payout, status, payout_cycle, payout_provider, external_payout_id)
         VALUES ($1, now()-interval '7 days', now(), 10000, 'processing', 'weekly', 'wise', $2) RETURNING id`, [c.promoterId, transferId])).rows[0].id;
    }
    const payoutStatus = async (id: string) => (await pool.query<{ status: string }>(`SELECT status FROM platform.payouts WHERE id=$1`, [id])).rows[0].status;
    // tvar notifikace dle oficiálního příkladu Wise (schema_version 2.0.0)
    const body = (transferId: string, state = 'outgoing_payment_sent') => JSON.stringify({
      data: { resource: { id: Number(transferId), profile_id: 1, account_id: 2, type: 'transfer' }, current_state: state, previous_state: 'processing', occurred_at: new Date().toISOString() },
      subscription_id: randomUUID(), event_type: 'transfers#state-change', schema_version: '2.0.0', sent_at: new Date().toISOString(),
    });
    const sig = (raw: string) => rsaSign('RSA-SHA256', Buffer.from(raw), wisePriv).toString('base64');

    it('oficiální testovací vektor Wise (sandbox klíč) se ověří', async () => {
      const { verifyWiseWebhookSignature } = await import('@/lib/payouts/wise');
      const sandboxPem = `-----BEGIN PUBLIC KEY-----
MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEAwpb91cEYuyJNQepZAVfP
ZIlPZfNUefH+n6w9SW3fykqKu938cR7WadQv87oF2VuT+fDt7kqeRziTmPSUhqPU
ys/V2Q1rlfJuXbE+Gga37t7zwd0egQ+KyOEHQOpcTwKmtZ81ieGHynAQzsn1We3j
wt760MsCPJ7GMT141ByQM+yW1Bx+4SG3IGjXWyqOWrcXsxAvIXkpUD/jK/L958Cg
nZEgz0BSEh0QxYLITnW1lLokSx/dTianWPFEhMC9BgijempgNXHNfcVirg1lPSyg
z7KqoKUN0oHqWLr2U1A+7kqrl6O2nx3CKs1bj1hToT1+p4kcMoHXA7kA+VBLUpEs
VwIDAQAB
-----END PUBLIC KEY-----`;
      const raw = '{"data":{"resource":{"id":49983981,"profile_id":16055450,"account_id":14124090,"type":"transfer"},"current_state":"incoming_payment_waiting","previous_state":null,"occurred_at":"2021-08-23T10:12:50Z"},"subscription_id":"90aa8e14-4ef1-4a56-861c-f3c9cde097ea","event_type":"transfers#state-change","schema_version":"2.0.0","sent_at":"2021-08-23T10:12:50Z"}';
      const s = 'wKcKCYXAzxNgiu7xmoDm943NUni7Rz33QN8JkEA9dWSGebgndonabgSj18Y4C08OrwVmueGsED2s00M7DtJVcYKOS1i3G4TMVx+mgM3aL9djMBkQtiYNBFUd6wrPI7ZUNHv/TrlKSjTMc+6JFvUvJ7owY3z85e3I4jLRLJowMFvO8kvCJ60+1pY9wDwZvtZ//WS93LrwGjk9Dvwzpmu0w+P4J75tETT5qC3Uv0y5G2yO8SEoO3yNP/tg/BOli02niHb53vEOUWUb9bly6thnfMoXoiV/osoGxgF20R58RlvkAmezyyl1Sv542TfS2DpiwVnmjjjkCyXeSUcKookYLQ==';
      expect(await withEnv({ WISE_WEBHOOK_PUBLIC_KEY: sandboxPem }, async () => verifyWiseWebhookSignature(raw, s))).toBe(true);
      expect(await withEnv({ WISE_WEBHOOK_PUBLIC_KEY: sandboxPem }, async () => verifyWiseWebhookSignature(raw.replace('49983981', '49983982'), s))).toBe(false);
    });
    it('chybějící klíč / bez podpisu / špatný podpis / HMAC místo RSA → 4xx, výplata beze změny', async () => {
      const tid = String(Date.now() % 1e9); const pid = await payout(tid);
      await ctl('wise', tid, { id: Number(tid), status: 'outgoing_payment_sent' });
      const raw = body(tid);
      const cases: Array<[string, Record<string, string | undefined>, Record<string, string>]> = [
        ['bez klíče (+ starý WISE_WEBHOOK_SECRET)', { WISE_WEBHOOK_PUBLIC_KEY: undefined, WISE_WEBHOOK_SECRET: 's' }, { 'x-signature-sha256': sig(raw) }],
        ['bez podpisu', {}, {}],
        ['špatný podpis', {}, { 'x-signature-sha256': sig(raw + ' ') }],
        ['HMAC místo RSA', { WISE_WEBHOOK_SECRET: 's' }, { 'x-signature-sha256': createHmac('sha256', 's').update(raw).digest('hex') }],
      ];
      for (const [label, env, h] of cases) {
        const res = await withEnv(env, async () => throughMiddleware(post('/api/payments/wise/webhook', raw, h), await hook()));
        expect(res.status, `wise ${label}`).toBeGreaterThanOrEqual(400);
        expect(res.status, `wise ${label}`).toBeLessThan(500);
        expect(await payoutStatus(pid), `wise ${label}: výplata`).toBe('processing');
      }
    });
    it('platný podpis, ale API Wise převod ještě neodeslalo → výplata NENÍ paid', async () => {
      const tid = String((Date.now() + 7) % 1e9); const pid = await payout(tid);
      await ctl('wise', tid, { id: Number(tid), status: 'processing' });
      const raw = body(tid);
      await throughMiddleware(post('/api/payments/wise/webhook', raw, { 'x-signature-sha256': sig(raw) }), await hook());
      expect(await payoutStatus(pid)).toBe('processing');
    });
    it('legitimní: platný RSA podpis + API outgoing_payment_sent → paid', async () => {
      const tid = String((Date.now() + 13) % 1e9); const pid = await payout(tid);
      await ctl('wise', tid, { id: Number(tid), status: 'outgoing_payment_sent' });
      const raw = body(tid);
      const res = await throughMiddleware(post('/api/payments/wise/webhook', raw, { 'x-signature-sha256': sig(raw) }), await hook());
      expect(res.status).toBe(200);
      expect(await payoutStatus(pid)).toBe('paid');
    });
  });

  // ───────────────────────── GoPay / ComGate ─────────────────────────
  describe('GoPay', () => {
    const hook = async () => (await import('@/app/api/payments/gopay/webhook/route')).GET as H;
    async function gopayPayment(amount: number): Promise<string> {
      // Kolo 7: simulátor vyžaduje token jako skutečná brána (scope dle doc.gopay.com).
      const r = await fetch(`${FAKE}/api/payments/payment`, { method: 'POST', headers: { authorization: 'Bearer fake-token-payment-create' }, body: JSON.stringify({ amount, currency: 'CZK' }) });
      return String((await r.json() as { id: number }).id);
    }
    it('nenakonfigurovaná brána (i mimo produkci: DEV_STUB) → 4xx, nic se nezmění', async () => {
      for (const nodeEnv of ['production', 'development']) {
        const pid = String(Date.now()) + nodeEnv.length; const oid = await pendingOrder('gopay', pid);
        const res = await withEnv({ GOPAY_CLIENT_ID: undefined, NODE_ENV: nodeEnv }, async () =>
          throughMiddleware(get(`/api/payments/gopay/webhook?id=${pid}`), await hook()));
        await expectUntouched(res, oid, `gopay nenakonfigurováno (${nodeEnv})`);
      }
    });
    it('API brány hlásí PAID s nulovou částkou → nezaplaceno', async () => {
      const pid = await gopayPayment(50000); const oid = await pendingOrder('gopay', pid);
      await gopayCtl(pid, { state: 'PAID', amount: 0 });
      await throughMiddleware(get(`/api/payments/gopay/webhook?id=${pid}`), await hook());
      expect(await orderState(oid)).toEqual({ status: 'pending', tickets: 0 });
    });
    it('neznámé / chybějící id → 4xx', async () => {
      const res = await throughMiddleware(get('/api/payments/gopay/webhook'), await hook());
      expect(res.status).toBe(400);
    });
    it('legitimní: API PAID s plnou částkou → paid', async () => {
      const pid = await gopayPayment(50000); const oid = await pendingOrder('gopay', pid);
      await gopayCtl(pid, { state: 'PAID' });
      const res = await throughMiddleware(get(`/api/payments/gopay/webhook?id=${pid}`), await hook());
      expect(res.status, await res.clone().text()).toBe(200);
      expect((await orderState(oid)).status).toBe('paid');
    });
  });

  describe('ComGate', () => {
    const hook = async () => (await import('@/app/api/payments/comgate/webhook/route')).POST as H;
    const form = (transId: string, refId: string, secret: string) =>
      new Request('http://localhost/api/payments/comgate/webhook', { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ transId, refId, status: 'PAID', price: '50000', curr: 'CZK', secret }).toString() });
    it('chybějící tajemství / špatné tajemství → 4xx, nic se nezmění', async () => {
      const t = `CG-${randomUUID().slice(0, 8)}`; const oid = await pendingOrder('comgate', t);
      const r1 = await withEnv({ COMGATE_MERCHANT: undefined, COMGATE_SECRET: undefined }, async () => throughMiddleware(form(t, oid, 'x'), await hook()));
      await expectUntouched(r1, oid, 'comgate bez tajemství');
      const r2 = await withEnv({ COMGATE_MERCHANT: 'm', COMGATE_SECRET: 'right', COMGATE_API_BASE_URL: `${FAKE}/comgate` }, async () => throughMiddleware(form(t, oid, 'wrong'), await hook()));
      await expectUntouched(r2, oid, 'comgate špatné tajemství');
    });
  });

  // ───────────────────────── Stripe ─────────────────────────
  describe('Stripe', () => {
    const hook = async () => (await import('@/app/api/payments/stripe/webhook/route')).POST as H;
    const evt = (sessionId: string, orderId: string) => JSON.stringify({
      id: `evt_${randomUUID().replace(/-/g, '')}`, type: 'checkout.session.completed',
      data: { object: { id: sessionId, payment_intent: null, customer: null, customer_email: null, payment_status: 'paid', amount_total: 50000, currency: 'czk', metadata: { orderId } } },
    });
    const sig = (raw: string, secret = 'whsec_fix') => { const t = Math.floor(Date.now() / 1000); return `t=${t},v1=${createHmac('sha256', secret).update(`${t}.${raw}`).digest('hex')}`; };
    it('chybějící tajemství / bez podpisu / špatný podpis → 4xx', async () => {
      const sid = `cs_${randomUUID().slice(0, 8)}`; const oid = await pendingOrder('stripe', sid);
      await ctl('stripe', sid, { id: sid, payment_status: 'paid', amount_total: 50000, currency: 'czk', metadata: { orderId: oid } });
      const raw = evt(sid, oid);
      await expectUntouched(await withEnv({ STRIPE_WEBHOOK_SECRET: undefined }, async () => throughMiddleware(post('/api/payments/stripe/webhook', raw, { 'stripe-signature': sig(raw) }), await hook())), oid, 'stripe bez tajemství');
      await expectUntouched(await throughMiddleware(post('/api/payments/stripe/webhook', raw), await hook()), oid, 'stripe bez podpisu');
      await expectUntouched(await throughMiddleware(post('/api/payments/stripe/webhook', raw, { 'stripe-signature': sig(raw, 'whsec_evil') }), await hook()), oid, 'stripe špatný podpis');
    });
    it('platný podpis, ale API session nezaplacená / nižší částka → nezaplaceno', async () => {
      const sid = `cs_${randomUUID().slice(0, 8)}`; const oid = await pendingOrder('stripe', sid);
      await ctl('stripe', sid, { id: sid, payment_status: 'unpaid', amount_total: 50000, currency: 'czk', metadata: { orderId: oid } });
      let raw = evt(sid, oid);
      await throughMiddleware(post('/api/payments/stripe/webhook', raw, { 'stripe-signature': sig(raw) }), await hook());
      expect((await orderState(oid)).status, 'API unpaid').toBe('pending');
      await ctl('stripe', sid, { id: sid, payment_status: 'paid', amount_total: 100, currency: 'czk', metadata: { orderId: oid } });
      raw = evt(sid, oid);
      await throughMiddleware(post('/api/payments/stripe/webhook', raw, { 'stripe-signature': sig(raw) }), await hook());
      expect((await orderState(oid)).status, 'API 1 Kč').toBe('pending');
    });
    it('legitimní → paid', async () => {
      const sid = `cs_${randomUUID().slice(0, 8)}`; const oid = await pendingOrder('stripe', sid);
      await ctl('stripe', sid, { id: sid, payment_status: 'paid', amount_total: 50000, currency: 'czk', metadata: { orderId: oid } });
      const raw = evt(sid, oid);
      const res = await throughMiddleware(post('/api/payments/stripe/webhook', raw, { 'stripe-signature': sig(raw) }), await hook());
      expect(res.status).toBe(200);
      expect((await orderState(oid)).status).toBe('paid');
    });
  });

  // ───────────────────────── Triple-A ─────────────────────────
  describe('Triple-A', () => {
    const hook = async () => (await import('@/app/api/payments/triplea/webhook/route')).POST as H;
    const raw = (ref: string, status = 'good') => JSON.stringify({ event: 'payment', payment_reference: ref, status, order_amount: 500, order_currency: 'CZK' });
    const sig = (b: string, secret = 'fix-notify') => { const t = Math.floor(Date.now() / 1000); return `t=${t},v1=${createHmac('sha256', secret).update(`${t}.${b}`).digest('hex')}`; };
    it('chybějící tajemství / bez podpisu / špatný podpis → 4xx', async () => {
      const ref = `TA-${randomUUID().slice(0, 8)}`; const oid = await pendingOrder('crypto', ref);
      const b = raw(ref);
      await expectUntouched(await withEnv({ TRIPLEA_NOTIFY_SECRET: undefined }, async () => throughMiddleware(post('/api/payments/triplea/webhook', b, { 'triplea-signature': sig(b) }), await hook())), oid, 'triplea bez tajemství');
      await expectUntouched(await throughMiddleware(post('/api/payments/triplea/webhook', b), await hook()), oid, 'triplea bez podpisu');
      await expectUntouched(await throughMiddleware(post('/api/payments/triplea/webhook', b, { 'triplea-signature': sig(b, 'evil') }), await hook()), oid, 'triplea špatný podpis');
    });
    it('platný podpis, ale API platbu nepotvrzuje (hold) → nezaplaceno', async () => {
      const ref = `TA-${randomUUID().slice(0, 8)}`; const oid = await pendingOrder('crypto', ref);
      await ctl('triplea', ref, { payment_reference: ref, status: 'hold', payment_tier: 'hold', order_amount: 500, order_currency: 'CZK' });
      const b = raw(ref);
      await throughMiddleware(post('/api/payments/triplea/webhook', b, { 'triplea-signature': sig(b) }), await hook());
      expect((await orderState(oid)).status).toBe('pending');
    });
    it('legitimní: podpis + API good s plnou částkou → paid', async () => {
      const ref = `TA-${randomUUID().slice(0, 8)}`; const oid = await pendingOrder('crypto', ref);
      await ctl('triplea', ref, { payment_reference: ref, status: 'good', payment_tier: 'good', order_amount: 500, order_currency: 'CZK' });
      const b = raw(ref);
      const res = await throughMiddleware(post('/api/payments/triplea/webhook', b, { 'triplea-signature': sig(b) }), await hook());
      expect(res.status).toBe(200);
      expect((await orderState(oid)).status).toBe('paid');
    });
  });

  // ───────────────────────── Mollie / Przelewy24 ─────────────────────────
  describe('Mollie', () => {
    const hook = async () => (await import('@/app/api/payments/mollie/webhook/route')).POST as H;
    const form = (id: string) => new Request('http://localhost/api/payments/mollie/webhook', { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: `id=${id}` });
    it('chybějící API klíč / platba u brány neexistuje → 4xx', async () => {
      const id = `tr_${randomUUID().slice(0, 8)}`; const oid = await pendingOrder('mollie', id);
      await expectUntouched(await withEnv({ MOLLIE_API_KEY: undefined }, async () => throughMiddleware(form(id), await hook())), oid, 'mollie bez klíče');
      await expectUntouched(await throughMiddleware(form(id), await hook()), oid, 'mollie neznámá platba');
    });
    it('legitimní: API paid s plnou částkou → paid', async () => {
      const id = `tr_${randomUUID().slice(0, 8)}`; const oid = await pendingOrder('mollie', id);
      await ctl('mollie', id, { id, status: 'paid', amount: { value: '500.00', currency: 'CZK' }, metadata: { orderId: oid } });
      const res = await throughMiddleware(form(id), await hook());
      expect(res.status).toBe(200);
      expect((await orderState(oid)).status).toBe('paid');
    });
  });

  describe('Przelewy24', () => {
    const hook = async () => (await import('@/app/api/payments/przelewy24/webhook/route')).POST as H;
    it('chybějící tajemství / bez podpisu / špatný podpis → 4xx', async () => {
      const sid = randomUUID(); const oid = await pendingOrder('przelewy24', sid);
      const b = (sign?: string) => JSON.stringify({ merchantId: 1, posId: 1, sessionId: sid, amount: 50000, originAmount: 50000, currency: 'PLN', orderId: 123, methodId: 1, statement: 'x', ...(sign ? { sign } : {}) });
      await expectUntouched(await withEnv({ P24_CRC_KEY: undefined }, async () => throughMiddleware(post('/api/payments/przelewy24/webhook', b('a'.repeat(96))), await hook())), oid, 'p24 bez tajemství');
      await expectUntouched(await withEnv({ P24_CRC_KEY: 'crc' }, async () => throughMiddleware(post('/api/payments/przelewy24/webhook', b()), await hook())), oid, 'p24 bez podpisu');
      await expectUntouched(await withEnv({ P24_CRC_KEY: 'crc' }, async () => throughMiddleware(post('/api/payments/przelewy24/webhook', b('f'.repeat(96))), await hook())), oid, 'p24 špatný podpis');
    });
  });

  // ───────────────────────── Benefit (Pluxee + generický) ─────────────────────────
  describe('Benefit callbacky', () => {
    // Kolo 10: benefitní karty jsou za přepínačem (výchozí vypnuto → 404, viz fix-r10-launch-flags); tady se ověřují
    // podpisy a částky ZAPNUTÉ funkce — jinak by 404 prošlo jako „nic nezaplaceno" naprázdno.
    beforeAll(() => { process.env.NEXT_PUBLIC_FEATURE_BENEFIT_CARDS = '1'; });
    afterAll(() => { delete process.env.NEXT_PUBLIC_FEATURE_BENEFIT_CARDS; });
    async function benefit(provider: string, amount = 50000): Promise<{ oid: string; ext: string }> {
      const ext = randomUUID(); const oid = await pendingOrder(provider, ext, amount);
      await pool.query(`INSERT INTO orders.benefit_payments (order_id, provider, amount_halire, status, external_id) VALUES ($1,$2,$3,'redirected',$4)`, [oid, provider, amount, ext]);
      return { oid, ext };
    }
    it('generický callback: ani s BENEFIT_MOCK=1 v produkci nic nezaplatí', async () => {
      const { oid, ext } = await benefit('pluxee');
      const { POST } = await import('@/app/api/payments/benefit/callback/route');
      const res = await withEnv({ BENEFIT_MOCK: '1', NODE_ENV: 'production' }, async () =>
        throughMiddleware(post('/api/payments/benefit/callback', JSON.stringify({ provider: 'pluxee', externalId: ext, success: true })), POST as H));
      await expectUntouched(res, oid, 'benefit generic + BENEFIT_MOCK v produkci');
    });
    it('Pluxee: chybějící tajemství / bez podpisu / špatný podpis / dev-skip v produkci → 4xx', async () => {
      const { oid, ext } = await benefit('pluxee');
      const { POST } = await import('@/app/api/payments/benefit/pluxee/callback/route');
      const b = JSON.stringify({ merchantTransactionId: ext, status: 'paid', paidAmountMinor: 50000, currency: 'CZK' });
      const good = createHmac('sha256', 'fix-pluxee').update(b).digest('hex');
      const p = '/api/payments/benefit/pluxee/callback';
      await expectUntouched(await withEnv({ PLUXEE_CALLBACK_SECRET: undefined }, async () => throughMiddleware(post(p, b, { 'x-pluxee-signature': good }), POST as H)), oid, 'pluxee bez tajemství');
      await expectUntouched(await throughMiddleware(post(p, b), POST as H), oid, 'pluxee bez podpisu');
      await expectUntouched(await throughMiddleware(post(p, b, { 'x-pluxee-signature': 'ab'.repeat(32) }), POST as H), oid, 'pluxee špatný podpis');
      await expectUntouched(await withEnv({ BENEFIT_DEV_SKIP_CALLBACK_VERIFY: '1', NODE_ENV: 'production' }, async () => throughMiddleware(post(p, b), POST as H)), oid, 'pluxee dev-skip v produkci');
    });
    it('Pluxee: platný podpis, ale zaplacená částka nižší než cena → nezaplaceno', async () => {
      const { oid, ext } = await benefit('pluxee');
      const { POST } = await import('@/app/api/payments/benefit/pluxee/callback/route');
      const b = JSON.stringify({ merchantTransactionId: ext, status: 'paid', paidAmountMinor: 100, currency: 'CZK' });
      await throughMiddleware(post('/api/payments/benefit/pluxee/callback', b, { 'x-pluxee-signature': createHmac('sha256', 'fix-pluxee').update(b).digest('hex') }), POST as H);
      expect((await orderState(oid)).status).toBe('pending');
    });
  });

  it('Pluxee legitimní: platný podpis + plná částka → paid (route musí fungovat pod tixly_app)', async () => {
    const ext = randomUUID(); const oid = await pendingOrder('pluxee', ext, 50000);
    await pool.query(`INSERT INTO orders.benefit_payments (order_id, provider, amount_halire, status, external_id) VALUES ($1,'pluxee',50000,'redirected',$2)`, [oid, ext]);
    const { POST } = await import('@/app/api/payments/benefit/pluxee/callback/route');
    const b = JSON.stringify({ merchantTransactionId: ext, status: 'paid', paidAmountMinor: 50000, currency: 'CZK' });
    const res = await withEnv({ NEXT_PUBLIC_FEATURE_BENEFIT_CARDS: '1' }, async () => throughMiddleware(post('/api/payments/benefit/pluxee/callback', b, { 'x-pluxee-signature': createHmac('sha256', 'fix-pluxee').update(b).digest('hex') }), POST as H));
    expect(res.status, await res.clone().text()).toBe(200);
    expect((await orderState(oid)).status).toBe('paid');
  });

  // ───────────────────────── QES (DocuSign / mock) ─────────────────────────
  describe('QES webhook', () => {
    async function signingRequest(ref: string): Promise<{ id: string; promoterId: string }> {
      const c = await clone.seed.chain();
      const id = (await pool.query<{ id: string }>(
        `INSERT INTO platform.qes_signing_requests (promoter_id, document_type, document_hash, signer_email, status, provider, external_ref)
         VALUES ($1, 'promoter_agreement', 'h', 's@x.test', 'sent', 'docusign', $2) RETURNING id`, [c.promoterId, ref])).rows[0].id;
      return { id, promoterId: c.promoterId };
    }
    const state = async (r: { id: string; promoterId: string }) => ({
      req: (await pool.query<{ status: string }>(`SELECT status FROM platform.qes_signing_requests WHERE id=$1`, [r.id])).rows[0].status,
      contract: (await pool.query<{ c: string | null }>(`SELECT contract_signed_at c FROM platform.promoters WHERE id=$1`, [r.promoterId])).rows[0].c,
    });
    const hook = async () => (await import('@/app/api/qes/webhook/route')).POST as H;
    it('mock provider v produkci / DocuSign bez HMAC klíče / špatný podpis → 4xx, smlouva nepodepsána', async () => {
      const { _resetQESProviderForTests } = await import('@/lib/qes');
      const cases: Array<[string, Record<string, string | undefined>, Record<string, string>]> = [
        ['mock v produkci', { QES_PROVIDER: 'mock', NODE_ENV: 'production' }, {}],
        ['docusign bez klíče', { QES_PROVIDER: 'docusign', DOCUSIGN_HMAC_KEY: undefined }, {}],
        ['docusign špatný podpis', { QES_PROVIDER: 'docusign', DOCUSIGN_HMAC_KEY: 'k' }, { 'x-docusign-signature-1': 'Zm9yZ2Vk' }],
      ];
      for (const [label, env, h] of cases) {
        const ref = `env-${randomUUID()}`; const r = await signingRequest(ref);
        const body = JSON.stringify({ requestId: ref, envelopeId: ref, status: 'signed', event: 'envelope-completed', data: { envelopeId: ref, envelopeSummary: { status: 'completed' } } });
        const res = await withEnv(env, async () => { _resetQESProviderForTests(); try { return await throughMiddleware(post('/api/qes/webhook', body, h), await hook()); } finally { _resetQESProviderForTests(); } });
        expect(res.status, `qes ${label}`).toBeGreaterThanOrEqual(400);
        expect(res.status, `qes ${label}`).toBeLessThan(500);
        expect(await state(r), `qes ${label}`).toEqual({ req: 'sent', contract: null });
      }
    });
  });

  // ───────────────────────── PayPal capture (návrat kupce) ─────────────────────────
  it('PayPal capture: PayPal objednávka jiné Tixly objednávky nezaplatí tuto', async () => {
    const pp = `PP-${randomUUID()}`; const other = `PP-${randomUUID()}`;
    const oid = await pendingOrder('paypal', pp);
    // „other" = skutečně schválená PayPal objednávka na stejnou částku, ale patřící JINÉ Tixly objednávce
    await ctl('paypal', other, { id: other, status: 'APPROVED', purchase_units: [{ reference_id: randomUUID(), payments: { captures: [{ id: 'CAP-O', status: 'COMPLETED', amount: { value: '500.00', currency_code: 'CZK' } }] } }] });
    const { GET } = await import('@/app/api/payments/paypal/capture/route');
    // capture cizí PayPal objednávky (other) proti naší objednávce oid
    const res = await throughMiddleware(get(`/api/payments/paypal/capture?orderId=${oid}&token=${other}`), GET as H);
    expect([302, 303, 307, 400, 404, 409]).toContain(res.status);
    expect(await orderState(oid)).toEqual({ status: 'pending', tickets: 0 });
  });
});
