// @vitest-environment node
/**
 * Kolo 3 / krok 4 — K3a: cron routy musí být autorizované.
 *
 * Nález: /api/internal/cron/recompute-dynamic-pricing (přepisuje ceny) a refresh-spotify neměly
 * ŽÁDNOU autorizaci (audit 06 K3a: anonym 200). Kontrola všech cron rout navíc našla dvě
 * fail-open (release-group-invite-holds, seat-upgrade-notify: bez INTERNAL_SERVICE_TOKEN v env
 * prošel jakýkoli token).
 *
 * Po opravě: recompute + refresh-spotify vyžadují CRON_SECRET přes lib/security/cron-auth.ts;
 * dispatcher (Vercel cron) ho ověřuje stejným helperem a předává dál; internal-token routy
 * jsou fail-closed. Inventura všech rout v api/cron a api/internal/cron je součástí testu.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { NextRequest } from 'next/server';
import { readFileSync, readdirSync } from 'fs';
import path from 'path';
import { createLocalClone, hasLocalDb, type LocalClone } from './helpers/local-fixture';
import { throughMiddleware } from './helpers/through-middleware';

const run = describe.skipIf(!hasLocalDb);
type H = (r: NextRequest) => Promise<Response>;
const API = path.resolve(__dirname, '../src/app/api');

describe('Krok 4 (kolo 3) — K3a: inventura autorizace cron rout', () => {
  it('každá routa v api/cron a api/internal/cron má autorizaci a je fail-closed', () => {
    const bad: string[] = [];
    for (const dir of ['cron', 'internal/cron']) {
      for (const job of readdirSync(path.join(API, dir))) {
        const src = readFileSync(path.join(API, dir, job, 'route.ts'), 'utf8');
        const cron = /isCronAuthorized\(req\)/.test(src);
        const internalHelper = /isInternalTokenAuthorized\(req\)/.test(src);
        const internalInline = /x-internal-token/.test(src) && /if \(!expected \|\| !safeEqual/.test(src);
        if (!cron && !internalHelper && !internalInline) bad.push(`${dir}/${job}`);
        if (/\(expected && token !== expected\)/.test(src)) bad.push(`${dir}/${job} (fail-open)`);
      }
    }
    expect(bad).toEqual([]);
  });
});

run('Krok 4 (kolo 3) — K3a: cron autorizace naživo', () => {
  let clone: LocalClone;
  const realFetch = globalThis.fetch;
  beforeAll(async () => { clone = await createLocalClone(); }, 120_000);
  afterAll(async () => { globalThis.fetch = realFetch; await clone?.cleanup(); }, 30_000);

  const req = (p: string, method: string, headers: Record<string, string> = {}) =>
    new Request(`http://localhost${p}`, { method, headers: { 'content-type': 'application/json', ...headers }, body: method === 'POST' ? '{}' : undefined });

  for (const job of ['recompute-dynamic-pricing', 'refresh-spotify']) {
    it(`${job}: bez tokenu / špatný token / x-internal-token bez CRON_SECRET → 401; Bearer CRON_SECRET → 200`, async () => {
      const mod = (await import(`@/app/api/internal/cron/${job}/route`)) as { POST: H; GET: H };
      for (const m of ['POST', 'GET'] as const) {
        expect((await throughMiddleware(req(`/api/internal/cron/${job}`, m), mod[m])).status, `${m} anonym`).toBe(401);
        expect((await throughMiddleware(req(`/api/internal/cron/${job}`, m, { authorization: 'Bearer wrong' }), mod[m])).status, `${m} špatný`).toBe(401);
      }
      const ok = await throughMiddleware(req(`/api/internal/cron/${job}`, 'POST', { authorization: `Bearer ${process.env.CRON_SECRET}` }), mod.POST);
      expect(ok.status, await ok.clone().text()).toBe(200);
    });
  }

  it('dispatcher: s CRON_SECRET spustí recompute (předá CRON_SECRET dál), bez něj 403', async () => {
    const { GET: dispatch } = await import('@/app/api/cron/dispatch/route');
    const { POST: recompute } = await import('@/app/api/internal/cron/recompute-dynamic-pricing/route');
    // Odchozí volání dispatcheru (na APP_URL) doručíme in-process skutečnému handleru — beze změny hlaviček.
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const u = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url);
      if (u.pathname === '/api/internal/cron/recompute-dynamic-pricing') {
        return throughMiddleware(new Request(`http://localhost${u.pathname}`, init), recompute as H);
      }
      return realFetch(input, init);
    }) as typeof fetch;
    try {
      const denied = await throughMiddleware(req('/api/cron/dispatch?job=recompute-dynamic-pricing', 'GET', { authorization: 'Bearer wrong' }), dispatch as H);
      expect(denied.status).toBe(403);
      const r = await throughMiddleware(req('/api/cron/dispatch?job=recompute-dynamic-pricing', 'GET', { authorization: `Bearer ${process.env.CRON_SECRET}` }), dispatch as H);
      const j = (await r.json()) as { status: number };
      expect(j.status, JSON.stringify(j)).toBe(200);
    } finally { globalThis.fetch = realFetch; }
  });

  for (const job of ['release-group-invite-holds', 'seat-upgrade-notify']) {
    it(`${job}: bez INTERNAL_SERVICE_TOKEN v env je fail-closed (libovolný token → 403)`, async () => {
      const { POST } = (await import(`@/app/api/internal/cron/${job}/route`)) as { POST: H };
      const saved = process.env.INTERNAL_SERVICE_TOKEN;
      delete process.env.INTERNAL_SERVICE_TOKEN;
      try {
        expect((await throughMiddleware(req(`/api/internal/cron/${job}`, 'POST', { 'x-internal-token': 'cokoli' }), POST)).status).toBe(403);
      } finally { process.env.INTERNAL_SERVICE_TOKEN = saved; }
      expect((await throughMiddleware(req(`/api/internal/cron/${job}`, 'POST', { 'x-internal-token': 'spatny' }), POST)).status).toBe(403);
      expect((await throughMiddleware(req(`/api/internal/cron/${job}`, 'POST', { 'x-internal-token': process.env.INTERNAL_SERVICE_TOKEN! }), POST)).status).not.toBe(403);
    });
  }
});
