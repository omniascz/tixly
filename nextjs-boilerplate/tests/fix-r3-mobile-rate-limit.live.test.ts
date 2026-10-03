// @vitest-environment node
/**
 * Kolo 3 / krok 2 — mobile/payment-intent musí mít STEJNÝ limit vytváření objednávek
 * jako checkout (K3), a to sdíleným mechanismem.
 *
 * mobile/payment-intent zadrží inventář a založí pending objednávku stejně jako checkout,
 * ale limit neměl → z jedné IP / jedním účtem šlo zamknout libovolnou kapacitu.
 *
 * Invarianty (shodné s checkoutem):
 *   - per IP: 10 objednávek / 10 min, a to SDÍLENĚ s webovým checkoutem (jinak by stačilo střídat cesty);
 *   - per kupující: max 5 současně živých nezaplacených objednávek.
 * Stripe = simulátor (fake-gopay :3998, /stripe/v1/payment_intents); přes skutečný middleware (Bearer JWT).
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { NextRequest } from 'next/server';
import type { Pool } from 'pg';
import { randomUUID } from 'crypto';
import { createLocalClone, hasLocalDb, type LocalClone } from './helpers/local-fixture';
import { throughMiddleware } from './helpers/through-middleware';

const run = describe.skipIf(!hasLocalDb);
type H = (r: NextRequest) => Promise<Response>;

run('Krok 2 (kolo 3) — mobile/payment-intent: limit objednávek jako checkout (K3)', () => {
  let clone: LocalClone;
  let pool: Pool;
  let chain: Awaited<ReturnType<LocalClone['seed']['chain']>>;
  let sign: (u: { id: string; email: string }) => Promise<string>;

  beforeAll(async () => {
    clone = await createLocalClone();
    pool = clone.pool;
    process.env.STRIPE_SECRET_KEY = 'sk_test_fix';
    process.env.STRIPE_API_BASE_URL = 'http://localhost:3998/stripe';
    chain = await clone.seed.chain({ remainingQty: 500, totalQty: 500 });
    const { signAccessToken } = await import('@/lib/auth');
    sign = (u) => signAccessToken({ id: u.id, email: u.email, name: 'T' } as never, { isPlatformAdmin: false, promoterMemberships: [] });
  }, 120_000);
  afterAll(async () => { await clone?.cleanup(); }, 30_000);

  const mobile = async (u: { id: string; email: string }, ip: string) => {
    const { POST } = await import('@/app/api/mobile/payment-intent/route');
    return throughMiddleware(new Request('http://localhost/api/mobile/payment-intent', {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${await sign(u)}`, 'x-real-ip': ip },
      body: JSON.stringify({ eventId: chain.eventId, ticketTypeId: chain.ticketTypeId, qty: 1 }),
    }), POST as H);
  };
  const ipOf = () => `10.${Math.floor(Math.random() * 250)}.${Math.floor(Math.random() * 250)}.${Math.floor(Math.random() * 250)}`;

  it('per IP: 10 objednávek projde, 11. → 429; kapacita a objednávky se 11. požadavkem nezmění', async () => {
    const ip = ipOf();
    const codes: number[] = [];
    for (let i = 0; i < 10; i++) codes.push((await mobile(await clone.seed.user(`mrl${i}`), ip)).status);
    expect(codes).toEqual(Array(10).fill(200));
    const before = (await pool.query(`SELECT remaining_qty FROM catalog.ticket_types WHERE id=$1`, [chain.ticketTypeId])).rows[0].remaining_qty;
    const u11 = await clone.seed.user('mrl11');
    const r = await mobile(u11, ip);
    expect(r.status).toBe(429);
    expect((await pool.query(`SELECT remaining_qty FROM catalog.ticket_types WHERE id=$1`, [chain.ticketTypeId])).rows[0].remaining_qty).toBe(before);
    expect((await pool.query(`SELECT count(*)::int n FROM orders.orders WHERE user_id=$1`, [u11.id])).rows[0].n).toBe(0);
  });

  it('per kupující: 5 živých nezaplacených objednávek, 6. → 429 TOO_MANY_PENDING_ORDERS (i z jiných IP)', async () => {
    const u = await clone.seed.user('mpend');
    const codes: number[] = [];
    for (let i = 0; i < 5; i++) codes.push((await mobile(u, ipOf())).status);
    expect(codes).toEqual(Array(5).fill(200));
    const r = await mobile(u, ipOf());
    expect(r.status).toBe(429);
    expect(((await r.json()) as { error: string }).error).toBe('TOO_MANY_PENDING_ORDERS');
  });

  it('IP limit je SDÍLENÝ s webovým checkoutem: 10× mobile, pak web checkout ze stejné IP → 429', async () => {
    const ip = ipOf();
    for (let i = 0; i < 10; i++) expect((await mobile(await clone.seed.user(`msh${i}`), ip)).status).toBe(200);
    const { POST: checkout } = await import('@/app/api/checkout/route');
    const r = await throughMiddleware(new Request('http://localhost/api/checkout', {
      method: 'POST', headers: { 'content-type': 'application/json', 'x-real-ip': ip },
      body: JSON.stringify({ eventId: chain.eventId, ticketTypeId: chain.ticketTypeId, quantity: 1,
        buyerEmail: `web-${randomUUID().slice(0, 8)}@fix.test`, buyerName: 'Web Kupec' }),
    }), checkout as H);
    expect(r.status).toBe(429);
  });
});
