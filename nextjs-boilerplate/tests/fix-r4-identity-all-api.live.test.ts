// @vitest-environment node
/**
 * Kolo 4 / krok 2 — routy bez identity (FIX_REPORT_R3 „Neopraveno" bod 3).
 *
 * Middleware ověřoval JWT a předával `x-user-id` jen u vyjmenovaných prefixů
 * (/api/buyer/, /api/checkout, …). Cesta mimo seznam prošla BEZ identity (podvržené
 * `x-user-id` se správně zahodí), takže routy, které identitu potřebují, vracely vždy 401
 * i přihlášenému (sociální síť, souhlasy, upozornění, losování, sezónky, převod lístku, …).
 * Kolo 3 to opravilo jen pro /api/mobile/ a /api/my/ přidáním dalších prefixů — každá nová
 * routa mimo seznam by vadu zopakovala.
 *
 * Očekávané: u KAŽDÉ /api cesty platný access token → `x-user-id` = sub tokenu;
 * bez tokenu / s neplatným tokenem / jen s podvrženou hlavičkou → žádné `x-user-id`.
 */
import { beforeAll, describe, expect, it } from 'vitest';
import { readFileSync } from 'fs';
import path from 'path';
import { createLocalClone, hasLocalDb, setupLocalEnv } from './helpers/local-fixture';
import { runMiddleware, throughMiddleware } from './helpers/through-middleware';
import type { NextRequest } from 'next/server';

type H = (r: NextRequest, ctx: unknown) => Promise<Response>;

const run = describe.skipIf(!hasLocalDb);
const LIST = path.resolve(__dirname, '../../logs/r3/2_unlisted_auth_routes.txt');
const USER = '11111111-2222-4333-8444-555555555555';

const concrete = (r: string) => r.replace(/\[[^\]]+\]/g, '00000000-0000-4000-8000-000000000001');

run('Krok 2 (kolo 4) — identita pro všechny /api cesty', () => {
  let tok: string;
  let routes: string[];
  beforeAll(async () => {
    setupLocalEnv();
    const { signAccessToken } = await import('@/lib/auth');
    tok = await signAccessToken({ id: USER, email: 'x@tixly.test', name: 'X' } as never, { isPlatformAdmin: false, promoterMemberships: [] } as never);
    routes = readFileSync(LIST, 'utf8').split('\n').map((s) => s.trim()).filter(Boolean);
  });

  it('25 rout z kola 3: platný Bearer → x-user-id předán (GET i POST)', async () => {
    const missing: string[] = [];
    for (const r of routes) {
      for (const method of ['GET', 'POST']) {
        const { blocked, forwardedHeaders } = await runMiddleware(new Request(`http://localhost${concrete(r)}`, {
          method, headers: { authorization: `Bearer ${tok}`, origin: 'http://localhost' },
        }));
        if (blocked || forwardedHeaders?.get('x-user-id') !== USER) missing.push(`${method} ${r} (${blocked?.status ?? 'bez x-user-id'})`);
      }
    }
    expect(missing).toEqual([]);
  });

  it('cookie accessToken stačí stejně jako Bearer', async () => {
    const { forwardedHeaders } = await runMiddleware(new Request('http://localhost/api/social/friends', {
      headers: { cookie: `accessToken=${tok}` },
    }));
    expect(forwardedHeaders?.get('x-user-id')).toBe(USER);
  });

  it('bez tokenu, s neplatným tokenem a s podvrženou hlavičkou → žádná identita', async () => {
    for (const r of routes) {
      for (const h of [{}, { authorization: 'Bearer nesmysl' }, { 'x-user-id': USER }] as Record<string, string>[]) {
        const { blocked, forwardedHeaders } = await runMiddleware(new Request(`http://localhost${concrete(r)}`, { headers: h }));
        if (!blocked) expect(forwardedHeaders?.get('x-user-id'), `${r} ${JSON.stringify(h)}`).toBeNull();
      }
    }
  });

  it('refresh token identitu nedává (K4d platí i mimo prefixy)', async () => {
    const { signRefreshToken } = await import('@/lib/auth');
    const rt = await signRefreshToken({ id: USER, email: 'x@tixly.test', name: 'X' } as never);
    const { forwardedHeaders } = await runMiddleware(new Request('http://localhost/api/social/friends', {
      headers: { authorization: `Bearer ${rt}` },
    }));
    expect(forwardedHeaders?.get('x-user-id') ?? null).toBeNull();
  });

  it('handlery dřív vždy 401: přihlášený teď 200, anonym 401 (social/friends, consent, friend-requests)', async () => {
    const clone = await createLocalClone();
    try {
      const u = await clone.seed.user('soc');
      const { signAccessToken } = await import('@/lib/auth');
      const t = await signAccessToken({ id: u.id, email: u.email, name: 'S' } as never, { isPlatformAdmin: false, promoterMemberships: [] } as never);
      for (const [url, mod] of [
        ['/api/social/friends', '@/app/api/social/friends/route'],
        ['/api/social/friend-requests', '@/app/api/social/friend-requests/route'],
        ['/api/consent', '@/app/api/consent/route'],
      ] as const) {
        const { GET } = await import(/* @vite-ignore */ mod);
        const own = await throughMiddleware(new Request(`http://localhost${url}`, { headers: { authorization: `Bearer ${t}` } }), GET as H, {});
        expect(own.status, `${url}: ${await own.clone().text()}`).toBe(200);
        const anon = await throughMiddleware(new Request(`http://localhost${url}`), GET as H, {});
        expect(anon.status, url).toBe(401);
      }
    } finally { await clone.cleanup(); }
  }, 120_000);
});
