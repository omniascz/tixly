// @vitest-environment node
/**
 * Kolo 4 / krok 2 — GENEROVANÝ test nad tabulkou všech API rout (logs/r4/2_routes.json,
 * vzniká `node audit/r4/classify-routes.mjs`).
 *
 * Pro každou NEVEŘEJNOU routu+metodu (kupec, pořadatel, prodejce, partner, admin, servis):
 * nepřihlášený požadavek skutečným middlewarem → handler musí skončit 401 nebo 403.
 * Dynamické segmenty se plní náhodným UUID, tělo je `{}`. Každé volání má timeout (SSE routy).
 * Běží v PRODUKČNÍM režimu (NODE_ENV=production, bez ALLOW_MOCK_PAYMENTS) — tak, jak se routy
 * chovají naživo (mock brány / mock QES → 403).
 *
 * Routy, které v harnessu spustit nejde (`cookies()` z next/headers mimo request scope), se
 * vypíšou zvlášť do `harness` a ověřují se HTTP požadavkem na běžící aplikaci (logs/r4/2_*).
 *
 * Test nesbírá jednotlivá selhání do 819 samostatných `it` — vypíše seznam rout, které
 * vrátily jiný status, do logs/r4/2_routes_anon_result.json a selže, když seznam není prázdný.
 */
import { beforeAll, describe, expect, it } from 'vitest';
import { readFileSync, writeFileSync } from 'fs';
import path from 'path';
import { randomUUID } from 'crypto';
import type { NextRequest } from 'next/server';
import { hasLocalDb, setupLocalEnv } from './helpers/local-fixture';
import { throughMiddleware } from './helpers/through-middleware';

const run = describe.skipIf(!hasLocalDb);
type H = (r: NextRequest, ctx: unknown) => Promise<Response>;
interface Row { route: string; method: string; caller: string; isPublic: boolean }

const ROOT = path.resolve(__dirname, '../..');
const TABLE = path.join(ROOT, 'logs/r4/2_routes.json');
const OUT = path.join(ROOT, 'logs/r4/2_routes_anon_result.json');
const TIMEOUT_MS = 8000;
// Kolo 10 / krok 3: routy vypnuté spouštěcím přepínačem (výchozí stav) odmítají každého 404 NOT_FOUND —
// ještě před ověřením identity. I to je odmítnutí anonyma; přijímá se jen u těchto rout a jen s tělem NOT_FOUND.
const FEATURE_OFF_ROUTES = new Set([
  'POST /api/buyer/orders/[orderId]/payment-plan',
  'GET /api/buyer/subscriptions',
  'POST /api/buyer/subscriptions',
  'POST /api/internal/cron/charge-installments',
  'POST /api/internal/cron/renew-subscriptions',
  'POST /api/mock-bnpl/[provider]/[paymentId]/confirm',
  'POST /api/payments/benefit/callback',
  'POST /api/payments/benefit/pluxee/callback',
  'GET /api/admin/events/[id]/payment-plans',
  'POST /api/admin/events/[id]/payment-plans',
  'POST /api/subscriptions/checkout',
  'POST /api/subscriptions/subscribe',
  'POST /api/subscriptions/holders/[paymentId]/confirm',
]);

function fill(route: string): { url: string; params: Record<string, string | string[]> } {
  const params: Record<string, string | string[]> = {};
  const url = route.replace(/\[(\.\.\.)?([^\]]+)\]/g, (_m, dots: string | undefined, name: string) => {
    const v = randomUUID();
    params[name] = dots ? [v] : v;
    return v;
  });
  return { url, params };
}

run('Krok 2 (kolo 4) — generovaný test: neveřejné routy bez přihlášení → 401/403', () => {
  let rows: Row[];
  beforeAll(() => {
    setupLocalEnv();
    (process.env as Record<string, string | undefined>).NODE_ENV = 'production';
    delete process.env.ALLOW_MOCK_PAYMENTS;
    rows = (JSON.parse(readFileSync(TABLE, 'utf8')) as Row[]).filter((r) => !r.isPublic);
  });

  it('každá neveřejná routa odmítne anonyma', async () => {
    const bad: { method: string; route: string; caller: string; status: number | string; body?: string }[] = [];
    const harness: string[] = [];
    let ok = 0;
    for (const r of rows) {
      const { url, params } = fill(r.route);
      let status: number | string;
      let body = '';
      try {
        const mod = (await import(/* @vite-ignore */ path.join(ROOT, "nextjs-boilerplate/src/app", r.route, "route.ts"))) as Record<string, H>;
        const handler = mod[r.method];
        const req = new Request(`http://localhost${url}`, {
          method: r.method,
          headers: r.method === 'GET' || r.method === 'DELETE' ? {} : { 'content-type': 'application/json' },
          body: r.method === 'GET' || r.method === 'DELETE' ? undefined : '{}',
        });
        const res = await Promise.race([
          throughMiddleware(req, handler, { params }),
          new Promise<'timeout'>((resolve) => setTimeout(() => resolve('timeout'), TIMEOUT_MS)),
        ]);
        if (res === 'timeout') { status = 'timeout'; }
        else {
          status = res.status;
          if (status !== 401 && status !== 403) body = (await res.text().catch(() => '')).slice(0, 160);
          else await res.body?.cancel().catch(() => undefined);
        }
      } catch (e) {
        status = `throw: ${(e as Error).message.slice(0, 120)}`;
      }
      if (status === 401 || status === 403) ok++;
      else if (status === 404 && FEATURE_OFF_ROUTES.has(`${r.method} ${r.route}`) && body.includes('NOT_FOUND')) ok++;
      else if (typeof status === 'string' && status.includes('outside a request scope')) harness.push(`${r.method} ${r.route}`);
      else bad.push({ method: r.method, route: r.route, caller: r.caller, status, body });
    }
    writeFileSync(OUT, JSON.stringify({ tested: rows.length, ok, harness, bad }, null, 1));
    console.log(`[routes-anon] tested=${rows.length} ok=${ok} harness=${harness.length} bad=${bad.length} -> ${OUT}`);
    expect(bad.map((b) => `${b.method} ${b.route} [${b.caller}] -> ${b.status}`)).toEqual([]);
    // Nová routa, kterou harness nespustí, se musí vědomě přidat (a ověřit přes HTTP).
    expect(harness).toEqual(['POST /api/oauth/authorize']);
  }, 1_800_000);
});
