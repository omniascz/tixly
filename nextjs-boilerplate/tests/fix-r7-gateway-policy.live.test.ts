// @vitest-environment node
/**
 * Kolo 7 / krok 6 — brány bez refundu (Stripe, Mollie, PayPal, Przelewy24, Triple-A) nejsou pro NOVÉ akce.
 * Refund přes API umí jen GoPay a ComGate (lib/payment/gateway-refund.ts → REFUND_UNSUPPORTED_PROVIDER);
 * peníze přijaté jinou bránou by při zrušení akce nešly vrátit.
 *
 * Očekávané: akce bez příznaku legacy_payment_gateways (= každá nová) → checkout s mollie/paypal/
 * przelewy24/crypto i automatické směrování EUR na Stripe odmítne 422 PAYMENT_METHOD_NOT_ALLOWED
 * bez založení objednávky; mobilní payment-intent (Stripe) 503 → aplikace přepne na webový checkout.
 * Existující akce (příznak z migrace 499) fungují jako dřív. GoPay pro novou akci projde.
 */
import { randomUUID } from 'crypto';
import type { NextRequest } from 'next/server';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createLocalClone, hasLocalDb, type LocalClone } from './helpers/local-fixture';
import { throughMiddleware } from './helpers/through-middleware';

const run = describe.skipIf(!hasLocalDb);
type H = (r: NextRequest, ctx?: unknown) => Promise<Response>;

run('Kolo 7 — brány bez refundu jen pro existující akce', () => {
  let clone: LocalClone;
  const saved: Record<string, string | undefined> = {};
  beforeAll(async () => {
    clone = await createLocalClone();
    for (const k of ['STRIPE_SECRET_KEY', 'PAYMENT_PROVIDER_EUR', 'STRIPE_API_BASE_URL']) saved[k] = process.env[k];
    // Žádné volání skutečného Stripe: nedosažitelná lokální adresa (RED běh bez ní zavolal api.stripe.com).
    process.env.STRIPE_API_BASE_URL = 'http://127.0.0.1:9';
  }, 120_000);
  afterAll(async () => {
    for (const [k, v] of Object.entries(saved)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
    await clone?.cleanup();
  }, 60_000);

  const checkout = async (c: { eventId: string; ticketTypeId: string }, paymentMethod: string) => {
    const { POST } = await import('@/app/api/checkout/route');
    const email = `gw-${randomUUID().slice(0, 8)}@tixly.test`;
    const r = await (POST as unknown as H)(new Request('http://localhost/api/checkout', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-forwarded-for': `198.51.102.${Math.floor(Math.random() * 250) + 1}` },
      body: JSON.stringify({ eventId: c.eventId, ticketTypeId: c.ticketTypeId, quantity: 1, buyerEmail: email, buyerName: 'GW', paymentMethod }),
    }) as unknown as NextRequest);
    const orders = (await clone.pool.query<{ n: number }>(
      `SELECT count(*)::int n FROM orders.orders o JOIN identity.users u ON u.id = o.user_id WHERE u.email = $1`, [email])).rows[0].n;
    return { status: r.status, body: await r.text(), orders };
  };

  it('nová akce: mollie / paypal / przelewy24 / crypto → 422 PAYMENT_METHOD_NOT_ALLOWED, žádná objednávka; gopay projde', async () => {
    const c = await clone.seed.chain();
    expect((await clone.pool.query(`SELECT legacy_payment_gateways FROM catalog.events WHERE id=$1`, [c.eventId])).rows[0].legacy_payment_gateways).toBe(false);
    for (const m of ['mollie', 'paypal', 'przelewy24', 'crypto']) {
      const r = await checkout(c, m);
      expect(r.status, `${m}: ${r.body}`).toBe(422);
      expect(r.body).toMatch(/PAYMENT_METHOD_NOT_ALLOWED/);
      expect(r.orders, m).toBe(0);
    }
    const ok = await checkout(c, 'gopay');
    expect(ok.status, ok.body).toBe(200);
  });

  it('nová akce v EUR: automatické směrování na Stripe → 422; s PAYMENT_PROVIDER_EUR=gopay projde', async () => {
    const c = await clone.seed.chain();
    await clone.pool.query(`UPDATE catalog.events SET currency='EUR' WHERE id=$1`, [c.eventId]);
    process.env.STRIPE_SECRET_KEY = 'sk_test_placeholder_r7_gateway';
    delete process.env.PAYMENT_PROVIDER_EUR;
    const r = await checkout(c, 'gopay');
    expect(r.status, r.body).toBe(422);
    expect(r.body).toMatch(/PAYMENT_METHOD_NOT_ALLOWED/);
    expect(r.orders).toBe(0);
    process.env.PAYMENT_PROVIDER_EUR = 'gopay';
    const ok = await checkout(c, 'gopay');
    expect(ok.status, ok.body).toBe(200);
    delete process.env.PAYMENT_PROVIDER_EUR;
  });

  it('existující akce (příznak z migrace) → brána se nezablokuje politikou', async () => {
    const c = await clone.seed.chain();
    await clone.pool.query(`UPDATE catalog.events SET legacy_payment_gateways = TRUE WHERE id=$1`, [c.eventId]);
    for (const m of ['mollie', 'paypal', 'przelewy24', 'crypto']) {
      const r = await checkout(c, m);
      expect(r.body, m).not.toMatch(/PAYMENT_METHOD_NOT_ALLOWED/);
    }
  });

  it('mobilní payment-intent (Stripe) pro novou akci → 503 PAYMENT_METHOD_NOT_ALLOWED (aplikace přepne na web)', async () => {
    const c = await clone.seed.chain();
    process.env.STRIPE_SECRET_KEY = 'sk_test_placeholder_r7_gateway';
    const u = await clone.seed.user('gwmob', 'Mobil');
    const { signAccessToken } = await import('@/lib/auth');
    const email = (await clone.pool.query(`SELECT email FROM identity.users WHERE id=$1`, [u.id])).rows[0].email;
    const tok = await signAccessToken({ id: u.id, email, name: 'M' } as never, { isPlatformAdmin: false, promoterMemberships: [] } as never);
    const { POST } = await import('@/app/api/mobile/payment-intent/route');
    const r = await throughMiddleware(new Request('http://localhost/api/mobile/payment-intent', {
      method: 'POST',
      headers: { 'content-type': 'application/json', origin: 'http://localhost', authorization: `Bearer ${tok}`, 'x-forwarded-for': '198.51.103.7' },
      body: JSON.stringify({ eventId: c.eventId, ticketTypeId: c.ticketTypeId, qty: 1 }),
    }), POST as unknown as H);
    expect(r.status, await r.clone().text()).toBe(503);
    expect(await r.text()).toMatch(/PAYMENT_METHOD_NOT_ALLOWED/);
    expect((await clone.pool.query(`SELECT count(*)::int n FROM orders.orders WHERE user_id=$1`, [u.id])).rows[0].n).toBe(0);
  });

  it('veřejný seznam typů vstupenek říká checkoutu, jestli akce smí brány bez refundu', async () => {
    const c = await clone.seed.chain();
    const { GET } = await import('@/app/api/events/[id]/ticket-types/route');
    const r = await (GET as unknown as H)(new Request(`http://localhost/api/events/${c.eventId}/ticket-types`) as unknown as NextRequest, { params: { id: c.eventId } });
    expect(r.status).toBe(200);
    expect(((await r.json()) as { legacyPaymentGateways?: boolean }).legacyPaymentGateways).toBe(false);
  });
});
