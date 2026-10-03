// @vitest-environment node
/**
 * Kolo 3 / krok 4 — K5 CSRF: stavové požadavky (POST/PUT/PATCH/DELETE) autentizované COOKIE
 * musí mít Origin (nebo Referer) vlastního webu; cizí nebo chybějící → 403 v middlewaru.
 *
 * Nález (audit 06 K5): POST /api/checkout s cookie přihlášeného kupce a Origin https://evil.example
 * prošel — ochrana stála jen na SameSite=Lax cookie.
 *
 * Výjimky: platební webhooky (server→server, podepsané), cron/interní routy, OAuth callback
 * (Apple form_post), Bearer API (hlavičku Authorization cizí stránka bez CORS neposlat neumí).
 * Bez auth cookie (anonym / host) není co zneužít → kontrola se neuplatní.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { NextRequest } from 'next/server';
import { createLocalClone, hasLocalDb, type LocalClone } from './helpers/local-fixture';
import { runMiddleware, throughMiddleware } from './helpers/through-middleware';

const run = describe.skipIf(!hasLocalDb);
type H = (r: NextRequest, ctx?: unknown) => Promise<Response>;
const OWN = 'http://localhost';
const EVIL = 'https://evil.example';

run('Krok 4 (kolo 3) — K5 CSRF (Origin/Referer pro cookie-autentizované stavové požadavky)', () => {
  let clone: LocalClone;
  let access: string;
  let fc: Awaited<ReturnType<LocalClone['seed']['fullChain']>>;
  beforeAll(async () => {
    clone = await createLocalClone();
    fc = await clone.seed.fullChain({ totalQty: 20, remainingQty: 19 }); // objednávka (1 ks) už kapacitu drží
    const email = (await clone.pool.query(`SELECT email FROM identity.users WHERE id=$1`, [fc.userId])).rows[0].email;
    const { signAccessToken } = await import('@/lib/auth');
    access = await signAccessToken({ id: fc.userId, email, name: 'K5' } as never, { isPlatformAdmin: false, promoterMemberships: [] });
  }, 120_000);
  afterAll(async () => { await clone?.cleanup(); }, 30_000);

  const mw = async (method: string, p: string, headers: Record<string, string>) => {
    const r = await runMiddleware(new Request(`${OWN}${p}`, { method, headers: { 'content-type': 'application/json', ...headers }, body: method === 'GET' ? undefined : '{}' }));
    return r.blocked?.status ?? 'pass';
  };
  const cookie = () => ({ cookie: `accessToken=${access}` });

  it('cookie + cizí Origin → 403', async () => {
    expect(await mw('POST', '/api/checkout', { ...cookie(), origin: EVIL })).toBe(403);
    expect(await mw('DELETE', '/api/buyer/spotify/connect', { ...cookie(), origin: EVIL })).toBe(403);
    expect(await mw('PATCH', '/api/admin/events/x', { ...cookie(), origin: EVIL })).toBe(403);
    expect(await mw('PUT', '/api/buyer/profile', { ...cookie(), origin: EVIL })).toBe(403);
  });
  it('cookie + chybí Origin i Referer → 403', async () => {
    expect(await mw('POST', '/api/checkout', cookie())).toBe(403);
  });
  it('cookie + cizí Referer (bez Origin) → 403; Origin "null" → 403', async () => {
    expect(await mw('POST', '/api/checkout', { ...cookie(), referer: `${EVIL}/x` })).toBe(403);
    expect(await mw('POST', '/api/checkout', { ...cookie(), origin: 'null' })).toBe(403);
  });
  it('cookie + vlastní Origin / vlastní Referer → projde', async () => {
    expect(await mw('POST', '/api/checkout', { ...cookie(), origin: OWN })).toBe('pass');
    expect(await mw('POST', '/api/checkout', { ...cookie(), referer: `${OWN}/cs/events/x` })).toBe('pass');
  });
  it('GET (bezpečná metoda) s cookie a cizím Origin → projde', async () => {
    expect(await mw('GET', '/api/buyer/restwert-balance', { ...cookie(), origin: EVIL })).toBe('pass');
  });
  it('Bearer API (platný token, bez cookie) s cizím Origin → projde; neplatný Bearer + cookie → 403', async () => {
    expect(await mw('POST', '/api/checkout', { authorization: `Bearer ${access}`, origin: EVIL })).toBe('pass');
    expect(await mw('POST', '/api/checkout', { authorization: 'Bearer neplatny', ...cookie(), origin: EVIL })).toBe(403);
  });
  it('anonym bez auth cookie s cizím Origin → projde (není co zneužít)', async () => {
    expect(await mw('POST', '/api/checkout', { origin: EVIL })).toBe('pass');
  });
  it('výjimky: platební webhooky, cron/interní, OAuth callback — i s cookie a cizím Origin', async () => {
    for (const p of ['/api/payments/gopay/webhook', '/api/payments/stripe/webhook', '/api/payments/comgate/webhook', '/api/payments/benefit/callback',
      '/api/qes/webhook', '/api/cron/dispatch', '/api/internal/order-completed', '/api/internal/cron/expire-pending-orders', '/api/auth/oauth/callback/apple']) {
      expect(await mw('POST', p, { ...cookie(), origin: EVIL }), p).toBe('pass');
    }
  });
  it('celý průchod: storno objednávky z cizího webu s cookie → 403 a objednávka beze změny; z vlastního → 200', async () => {
    const { POST } = await import('@/app/api/buyer/orders/[orderId]/cancel/route');
    const call = (origin: string) => throughMiddleware(new Request(`${OWN}/api/buyer/orders/${fc.orderId}/cancel`, {
      method: 'POST', headers: { 'content-type': 'application/json', ...cookie(), origin }, body: JSON.stringify({ reason: 'csrf' }) }),
      POST as H, { params: { orderId: fc.orderId } });
    expect((await call(EVIL)).status).toBe(403);
    expect((await clone.pool.query(`SELECT status FROM orders.orders WHERE id=$1`, [fc.orderId])).rows[0].status).toBe('paid');
    const ok = await call(OWN);
    expect(ok.status, await ok.clone().text()).toBe(200);
  });
});
