// @vitest-environment node
/**
 * Kolo 3 / krok 2 — /api/mobile/* nedostávalo identitu: middleware ověřuje JWT a nastavuje
 * x-user-id jen pro vyjmenované prefixy, /api/mobile/ mezi nimi nebyl → požadavek prošel
 * BEZ identity a runAsUser vždy vrátil 401 (mobilní platba nefungovala ani s platným tokenem).
 * Podvržené x-user-id middleware zahazuje vždy — to musí platit dál.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { NextRequest } from 'next/server';
import { createLocalClone, hasLocalDb, type LocalClone } from './helpers/local-fixture';
import { throughMiddleware } from './helpers/through-middleware';

const run = describe.skipIf(!hasLocalDb);
type H = (r: NextRequest) => Promise<Response>;

run('Krok 2 (kolo 3) — /api/mobile/* ověřuje Bearer JWT', () => {
  let clone: LocalClone;
  let chain: Awaited<ReturnType<LocalClone['seed']['chain']>>;
  beforeAll(async () => {
    clone = await createLocalClone();
    process.env.STRIPE_SECRET_KEY = 'sk_test_fix';
    process.env.STRIPE_API_BASE_URL = 'http://localhost:3998/stripe';
    chain = await clone.seed.chain({ remainingQty: 50 });
    // Kolo 7: Stripe (mobil) jen pro akce z doby před mig. 499 — test ověřuje tuto existující cestu.
    await clone.pool.query(`UPDATE catalog.events SET legacy_payment_gateways = TRUE WHERE id=$1`, [chain.eventId]);
  }, 120_000);
  afterAll(async () => { await clone?.cleanup(); }, 30_000);

  const call = async (headers: Record<string, string>) => {
    const { POST } = await import('@/app/api/mobile/payment-intent/route');
    return throughMiddleware(new Request('http://localhost/api/mobile/payment-intent', {
      method: 'POST', headers: { 'content-type': 'application/json', 'x-real-ip': `10.9.${Date.now() % 250}.1`, ...headers },
      body: JSON.stringify({ eventId: chain.eventId, ticketTypeId: chain.ticketTypeId, qty: 1 }),
    }), POST as H);
  };

  it('platný Bearer → 200, objednávka patří přihlášenému uživateli', async () => {
    const u = await clone.seed.user('mauth');
    const { signAccessToken } = await import('@/lib/auth');
    const t = await signAccessToken({ id: u.id, email: u.email, name: 'T' } as never, { isPlatformAdmin: false, promoterMemberships: [] });
    const r = await call({ authorization: `Bearer ${t}` });
    expect(r.status, await r.clone().text()).toBe(200);
    const { orderId } = (await r.json()) as { orderId: string };
    expect((await clone.pool.query(`SELECT user_id FROM orders.orders WHERE id=$1`, [orderId])).rows[0].user_id).toBe(u.id);
  });
  it('bez tokenu → 401; podvržené x-user-id → 401 (nic nevznikne)', async () => {
    const victim = await clone.seed.user('mvictim');
    expect((await call({})).status).toBe(401);
    expect((await call({ 'x-user-id': victim.id })).status).toBe(401);
    expect((await clone.pool.query(`SELECT count(*)::int n FROM orders.orders WHERE user_id=$1`, [victim.id])).rows[0].n).toBe(0);
  });
  it('neplatný Bearer → 401', async () => {
    expect((await call({ authorization: 'Bearer abc.def.ghi' })).status).toBe(401);
  });
});
