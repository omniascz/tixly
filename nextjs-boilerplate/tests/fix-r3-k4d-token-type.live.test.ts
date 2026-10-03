// @vitest-environment node
/**
 * Kolo 3 / krok 4 — K4d: refresh token (7 dní) nesmí fungovat jako access token.
 *
 * Oba tokeny podepisuje tentýž klíč; access token neměl typ a ověřování (middleware,
 * platform-auth, server-session, /api/auth/me, oauth/authorize) bralo jakýkoli platný JWT se `sub`
 * → refresh token z cookie prošel jako přihlášení na /api/buyer/* (audit 06: 200 místo 401).
 *
 * Po opravě: access token nese `type: 'access'`, refresh `type: 'refresh'`; každá strana
 * vyžaduje svůj typ (sdílený helper lib/security/token-type.ts).
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { NextRequest } from 'next/server';
import { createLocalClone, hasLocalDb, type LocalClone } from './helpers/local-fixture';
import { throughMiddleware } from './helpers/through-middleware';

const run = describe.skipIf(!hasLocalDb);
type H = (r: NextRequest, ctx?: unknown) => Promise<Response>;

run('Krok 4 (kolo 3) — K4d: typ tokenu access vs refresh', () => {
  let clone: LocalClone;
  let user: { id: string; email: string };
  let access: string;
  let refresh: string;
  beforeAll(async () => {
    clone = await createLocalClone();
    user = await clone.seed.user('k4d');
    const { signAccessToken, signRefreshToken } = await import('@/lib/auth');
    access = await signAccessToken({ id: user.id, email: user.email, name: 'K4d' } as never, { isPlatformAdmin: false, promoterMemberships: [] });
    refresh = await signRefreshToken({ id: user.id, email: user.email, name: 'K4d' } as never);
  }, 120_000);
  afterAll(async () => { await clone?.cleanup(); }, 30_000);

  const buyerGet = async (headers: Record<string, string>) => {
    const { GET } = await import('@/app/api/buyer/restwert-balance/route');
    return throughMiddleware(new Request('http://localhost/api/buyer/restwert-balance', { headers }), GET as H);
  };

  it('access token (Bearer i cookie) → 200', async () => {
    expect((await buyerGet({ authorization: `Bearer ${access}` })).status).toBe(200);
    expect((await buyerGet({ cookie: `accessToken=${access}` })).status).toBe(200);
  });

  it('refresh token jako Bearer → 401', async () => {
    expect((await buyerGet({ authorization: `Bearer ${refresh}` })).status).toBe(401);
  });

  it('refresh token podstrčený do accessToken cookie → 401', async () => {
    expect((await buyerGet({ cookie: `accessToken=${refresh}` })).status).toBe(401);
  });

  it('/api/auth/me s refresh tokenem v accessToken cookie → user: null', async () => {
    const { GET } = await import('@/app/api/auth/me/route');
    const { NextRequest } = await import('next/server');
    const r = await GET(new NextRequest('http://localhost/api/auth/me', { headers: { cookie: `accessToken=${refresh}` } }));
    expect(((await r.json()) as { user: unknown }).user).toBeNull();
    const ok = await GET(new NextRequest('http://localhost/api/auth/me', { headers: { cookie: `accessToken=${access}` } }));
    expect(((await ok.json()) as { user: { id: string } }).user.id).toBe(user.id);
  });

  it('platform admin: refresh token admina neprojde requirePlatformAdmin', async () => {
    const { signAccessToken, signRefreshToken } = await import('@/lib/auth');
    const adminAccess = await signAccessToken({ id: user.id, email: user.email, name: 'A' } as never, { isPlatformAdmin: true, promoterMemberships: [] });
    const adminRefresh = await signRefreshToken({ id: user.id, email: user.email, name: 'A' } as never);
    const { requirePlatformAdmin } = await import('@/lib/platform-auth');
    const { NextRequest } = await import('next/server');
    expect(await requirePlatformAdmin(new NextRequest('http://localhost/x', { headers: { authorization: `Bearer ${adminAccess}` } }))).toEqual({ userId: user.id });
    expect(await requirePlatformAdmin(new NextRequest('http://localhost/x', { headers: { authorization: `Bearer ${adminRefresh}` } }))).toBeNull();
  });

  it('druhá strana: access token jako refresh → 401 (POST /api/auth/refresh)', async () => {
    const { POST } = await import('@/app/api/auth/refresh/route');
    const { NextRequest } = await import('next/server');
    const r = await POST(new NextRequest('http://localhost/api/auth/refresh', { method: 'POST', headers: { cookie: `refreshToken=${access}` } }));
    expect(r.status).toBe(401);
    const ok = await POST(new NextRequest('http://localhost/api/auth/refresh', { method: 'POST', headers: { cookie: `refreshToken=${refresh}` } }));
    expect(ok.status).toBe(200);
  });

  it('nový access token z /api/auth/refresh nese type=access', async () => {
    const { POST } = await import('@/app/api/auth/refresh/route');
    const { NextRequest } = await import('next/server');
    const r = await POST(new NextRequest('http://localhost/api/auth/refresh', { method: 'POST', headers: { cookie: `refreshToken=${refresh}` } }));
    const setCookie = r.headers.getSetCookie().find((c) => c.startsWith('accessToken='))!;
    const tok = setCookie.split(';')[0].slice('accessToken='.length);
    const payload = JSON.parse(Buffer.from(tok.split('.')[1], 'base64url').toString());
    expect(payload.type).toBe('access');
  });
});
