// @vitest-environment node
/**
 * Kolo 4 / krok 2 — routy kupce kontrolovaly konfiguraci dřív než přihlášení: anonym dostal
 * 503 (WALLET_NOT_CONFIGURED / STRIPE_NOT_CONFIGURED) místo 401 a dozvěděl se stav konfigurace.
 * Generovaný test nad tabulkou rout (fix-r4-routes-anon) je odhalil; tady cílený regresní test.
 * Očekávané: bez přihlášení 401 bez ohledu na konfiguraci; přihlášený bez konfigurace 503.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { NextRequest } from 'next/server';
import { createLocalClone, hasLocalDb, type LocalClone } from './helpers/local-fixture';
import { throughMiddleware } from './helpers/through-middleware';

const run = describe.skipIf(!hasLocalDb);
type H = (r: NextRequest, ctx: unknown) => Promise<Response>;
const env = process.env as Record<string, string | undefined>;
const ID = '00000000-0000-4000-8000-000000000001';

run('Krok 2 (kolo 4) — přihlášení se kontroluje před konfigurací', () => {
  let clone: LocalClone;
  let tok: string;
  const saved = { ...env };
  beforeAll(async () => {
    clone = await createLocalClone();
    const u = await clone.seed.user('cfg');
    const { signAccessToken } = await import('@/lib/auth');
    tok = await signAccessToken({ id: u.id, email: u.email, name: 'C' } as never, { isPlatformAdmin: false, promoterMemberships: [] } as never);
    for (const k of ['APPLE_PASS_TYPE_IDENTIFIER', 'APPLE_PASS_CERT_PEM', 'APPLE_TEAM_IDENTIFIER', 'STRIPE_SECRET_KEY']) delete env[k];
  }, 120_000);
  afterAll(async () => { Object.assign(env, saved); await clone?.cleanup(); }, 30_000);

  const cases = [
    ['GET', `/api/buyer/cross-passes/${ID}/wallet/apple`, '@/app/api/buyer/cross-passes/[membershipId]/wallet/apple/route', { params: { membershipId: ID } }],
    ['POST', '/api/mobile/payment-intent', '@/app/api/mobile/payment-intent/route', {}],
  ] as const;

  it('anonym 401, přihlášený 503 (nenakonfigurováno)', async () => {
    for (const [method, url, mod, ctx] of cases) {
      const m = (await import(/* @vite-ignore */ mod)) as unknown as Record<string, H>;
      const mk = (h: Record<string, string>) => new Request(`http://localhost${url}`, {
        method, headers: { ...h, ...(method === 'POST' ? { 'content-type': 'application/json' } : {}) },
        body: method === 'POST' ? '{}' : undefined,
      });
      const anon = await throughMiddleware(mk({}), m[method], ctx);
      expect(anon.status, `${url} anonym: ${await anon.clone().text()}`).toBe(401);
      const authed = await throughMiddleware(mk({ authorization: `Bearer ${tok}` }), m[method], ctx);
      expect(authed.status, `${url} přihlášený`).toBe(503);
    }
  });
});
