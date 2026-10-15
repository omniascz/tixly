/**
 * Kolo 19 / krok 2 — Sentry 11: chyby dorazí, osobní údaje ne, tunel z prohlížeče funguje.
 *
 * Skutečné SDK (@sentry/nextjs v aplikaci, žádný mock) → obálky přes HTTP do simulátoru e2e/load/r14-fake-sentry.mjs.
 *   (a) chyba z route handleru (POST /api/ops/sentry-check) dorazí;
 *   (b) selhání cronu přes dispatcher (502) dorazí;
 *   (c) chyba vyvolaná v prohlížeči nepřihlášeného návštěvníka jde přes tunel /api/monitoring a dorazí;
 *   (d) v žádné obálce (události, transakce, spany, session …) není e-mail, telefon, jméno kupce, IP adresa
 *       (user.ip_address, {{auto}}), cookie, hlavička authorization / cookie / x-internal-token / x-user-id ani tělo
 *       požadavku s údaji kupce (testovací data jako tests/r14-sentry-scrub.test.ts);
 *   (e) z user zůstane nanejvýš id;
 *   (f) neveřejné /api/* cesty middleware dál bez přihlášení odmítá (stejný stavový kód jako na baseline).
 * Prostředí (logs/r19/run_sentry.sh): next start :3200 nad r19demo (create.sh --local), simulátor :3995 (výstup R19_SIM_OUT),
 * server SENTRY_DSN = http://…@127.0.0.1:3995/1. Prohlížeč používá tunel jen u DSN ve tvaru Sentry SaaS (SDK:
 * applyTunnelRouteOption) — proto má klient DSN o1.ingest.sentry.io (jen řetězec) a server přepisuje tunel na simulátor
 * (_SENTRY_TUNNEL_DESTINATION_OVERRIDE při buildu). Pojistka: prohlížeč smí jen na localhost/127.0.0.1, ostatní
 * požadavky se zablokují v prohlížeči a *.sentry.io se navíc nepřeloží (host-resolver-rules) — nic neodchází ven.
 */
import { existsSync, readFileSync } from 'node:fs';
import { expect, test } from '@playwright/test';

const BASE = process.env.BASE_URL ?? 'http://localhost:3200';
const SIM = process.env.R19_SIM ?? 'http://127.0.0.1:3995';
const SIM_OUT = process.env.R19_SIM_OUT ?? '';
const CRON = process.env.CRON_SECRET ?? '';
const INTERNAL = process.env.INTERNAL_SERVICE_TOKEN ?? '';
const OWNER = { email: 'demo@tixly-staging.test', pass: 'Demo2026!heslo' };
// stejná testovací data jako tests/r14-sentry-scrub.test.ts
const PII = { email: 'jana@x.cz', phone: '+420 777 123 456', name: 'Jana Nováková' };
const IP = '10.255.255.1';
const FAKE_INTERNAL = `r19-internal-${Date.now().toString(36)}`;
const FORGED_USER = '00000000-0000-4000-a000-0000000019ff';
// stavové kódy neveřejných /api cest bez přihlášení na baseline (logs/r19/0_sentry_baseline.txt)
const PRIVATE = [
  ['GET', '/api/admin/events', 401],
  ['GET', '/api/orders/00000000-0000-4000-a000-000000000001', 401],
  ['GET', '/api/platform/promoters', 401],
] as const;

test.use({ launchOptions: { args: ['--host-resolver-rules=MAP *.sentry.io ~NOTFOUND'] } });

interface Item { t: string; url: string; item_type?: string; raw: Record<string, unknown> }
const items = (): Item[] => (existsSync(SIM_OUT) ? readFileSync(SIM_OUT, 'utf8').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l) as Item) : []);
const rawBodies = (): string[] => (existsSync(`${SIM_OUT}.raw.jsonl`)
  ? readFileSync(`${SIM_OUT}.raw.jsonl`, 'utf8').trim().split('\n').filter(Boolean).map((l) => (JSON.parse(l) as { body: string }).body) : []);
const exceptionOf = (i: Item): string => ((i.raw.exception as { values?: Array<{ value?: string }> } | undefined)?.values?.[0]?.value ?? '');
async function waitForEvent(match: (i: Item) => boolean, ms = 30_000): Promise<Item | undefined> {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    const hit = items().find(match);
    if (hit) return hit;
    await new Promise((r) => setTimeout(r, 500));
  }
  return undefined;
}

let accessToken = '';
const log: string[] = [];
const note = (s: string): void => { log.push(s); console.log(`[r19] ${s}`); };

test.beforeAll(async ({ request }) => {
  expect(SIM_OUT, 'R19_SIM_OUT').not.toBe('');
  expect((await request.get(`${SIM}/_events`)).status()).toBe(200);
  expect(CRON.length).toBeGreaterThan(0);
  const res = await request.post(`${BASE}/api/auth/login`, { data: { email: OWNER.email, password: OWNER.pass }, headers: { 'x-real-ip': '10.77.19.1' } });
  expect(res.status(), await res.text()).toBe(200);
  accessToken = res.headers()['set-cookie']?.match(/accessToken=([^;]+)/)?.[1] ?? '';
  expect(accessToken.length).toBeGreaterThan(20);
});

const piiHeaders = (): Record<string, string> => ({
  authorization: `Bearer ${CRON}`,
  cookie: `accessToken=${accessToken}; r19_buyer=${encodeURIComponent(PII.email)}`,
  origin: BASE,
  'x-user-id': FORGED_USER,
  'x-internal-token': FAKE_INTERNAL,
  'x-real-ip': IP,
  'x-forwarded-for': IP,
});

// Jeden test, každý bod je krok s měkkou kontrolou — vyhodnotí se všechny body i když některý selže (RED doloží všechny).
test('Sentry 11: (a)–(f) proti simulátoru', async ({ request, browser }) => {
  await test.step('(f) neveřejné /api cesty bez přihlášení: stejný stavový kód jako na baseline', async () => {
    for (const [method, path, status] of PRIVATE) {
      const res = await request.fetch(`${BASE}${path}`, { method, headers: { 'x-real-ip': IP } });
      note(`(f) ${method} ${path} → ${res.status()}`);
      expect.soft(res.status(), path).toBe(status);
    }
  });

  await test.step('(a) chyba z route handleru dorazí', async () => {
    const res = await request.post(`${BASE}/api/ops/sentry-check?email=${encodeURIComponent(PII.email)}&tel=${encodeURIComponent(PII.phone)}`, {
      headers: piiHeaders(),
      data: { buyerName: PII.name, buyerEmail: PII.email, buyerPhone: PII.phone, items: [{ seatId: 's-1' }] },
    });
    note(`(a) POST /api/ops/sentry-check → ${res.status()}`);
    expect.soft(res.status()).toBe(500);
    const ev = await waitForEvent((i) => exceptionOf(i).startsWith('Sentry kontrola'));
    note(`(a) událost: ${ev ? exceptionOf(ev) : 'NEDORAZILA'}; release=${String(ev?.raw.release)}`);
    expect.soft(ev, '(a) událost ze sentry-check').toBeTruthy();
  });

  await test.step('(b) selhání cronu přes dispatcher (502) dorazí', async () => {
    const res = await request.get(`${BASE}/api/cron/dispatch?job=charge-installments`, { headers: piiHeaders() });
    note(`(b) GET /api/cron/dispatch?job=charge-installments → ${res.status()}`);
    expect.soft(res.status()).toBe(502);
    const ev = await waitForEvent((i) => exceptionOf(i).startsWith('Cron charge-installments selhal'));
    note(`(b) událost: ${ev ? `${exceptionOf(ev)} tags=${JSON.stringify(ev.raw.tags)}` : 'NEDORAZILA'}`);
    expect.soft(ev, '(b) událost ze selhání cronu').toBeTruthy();
  });

  await test.step('(c) chyba v prohlížeči nepřihlášeného návštěvníka jde přes /api/monitoring a dorazí', async () => {
    const ctx = await browser.newContext({ baseURL: BASE, viewport: { width: 1440, height: 900 } });
    await ctx.setExtraHTTPHeaders({ 'x-real-ip': IP, 'x-forwarded-for': IP });
    await ctx.addCookies([{ name: 'r19_buyer', value: encodeURIComponent(PII.email), url: BASE }]);
    await ctx.addInitScript(() => { try { window.localStorage.setItem('tixly.cookie-consent', JSON.stringify({ essential: true, analytics: false, marketing: false, decidedAt: '2026-10-15T00:00:00.000Z' })); } catch { /* */ } });
    const blocked: string[] = [];
    await ctx.route('**/*', (route) => {
      const u = new URL(route.request().url());
      if (u.hostname === 'localhost' || u.hostname === '127.0.0.1') return route.continue();
      blocked.push(u.host);
      return route.abort();
    });
    const tunnel: string[] = []; const direct: string[] = [];
    const page = await ctx.newPage();
    page.on('response', (r) => {
      const u = new URL(r.url());
      if (u.pathname.startsWith('/api/monitoring')) tunnel.push(`${r.request().method()} ${u.pathname}${u.search} → ${r.status()}`);
      if (u.port === '3995') direct.push(`${r.request().method()} ${u.host}${u.pathname} → ${r.status()}`);
    });
    await page.goto(`/cs/events?email=${encodeURIComponent(PII.email)}`, { waitUntil: 'domcontentloaded' });
    await page.waitForLoadState('networkidle', { timeout: 30_000 }).catch(() => {});
    expect.soft(await page.evaluate(() => typeof (window as unknown as { __SENTRY__?: unknown }).__SENTRY__), '(c) SDK v prohlížeči načtené').toBe('object');
    await page.evaluate((m) => { setTimeout(() => { throw new Error(m); }, 0); }, `R19 chyba v prohlížeči: kupec ${PII.email}, tel. ${PII.phone}, ${PII.name}`);
    const ev = await waitForEvent((i) => exceptionOf(i).startsWith('R19 chyba v prohlížeči'));
    await page.waitForTimeout(1500);
    note(`(c) událost: ${ev ? exceptionOf(ev) : 'NEDORAZILA'}`);
    note(`(c) požadavky na tunel: ${JSON.stringify(tunnel)}; přímo na simulátor: ${JSON.stringify(direct)}; zablokováno mimo localhost: ${JSON.stringify([...new Set(blocked)])}`);
    await ctx.close();
    expect(blocked.filter((h) => h.includes('sentry.io')), '(c) žádný pokus o sentry.io').toEqual([]);
    expect.soft(ev, '(c) událost z prohlížeče').toBeTruthy();
    expect.soft(tunnel.some((t) => t.startsWith('POST /api/monitoring') && t.endsWith('→ 200')), '(c) odesláno přes tunel /api/monitoring (200)').toBe(true);
    expect.soft(direct, '(c) prohlížeč neposílá přímo na DSN').toEqual([]);
  });

  await test.step('(d)+(e) obálky bez osobních údajů; z user nanejvýš id', async () => {
    await new Promise((r) => setTimeout(r, 8000)); // dávky spanů / transakcí
    const bodies = rawBodies();
    const all = items();
    note(`obálek: ${bodies.length}; položek event/transaction/span: ${all.length} (${JSON.stringify(all.reduce<Record<string, number>>((a, i) => { const k = i.item_type ?? String(i.raw.type ?? 'event'); a[k] = (a[k] ?? 0) + 1; return a; }, {}))})`);
    const text = bodies.join('\n');
    const forbidden: Array<[string, RegExp]> = [
      ['e-mail', /jana(?:@|%40|\\u0040)x\.cz/i],
      ['telefon', /777[\s+%20-]*123[\s+%20-]*456/],
      ['jméno', /Nov(?:á|\\u00e1|%C3%A1)kov(?:á|\\u00e1|%C3%A1)/i],
      ['IP adresa', /10\.255\.255\.1\b/],
      ['{{auto}}', /\{\{auto\}\}/],
      ['user.ip_address', /"ip_address"|"user\.ip_address"|"client\.address"/],
      ['CRON_SECRET', new RegExp(CRON.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))],
      ['access token', new RegExp(accessToken.slice(0, 40).replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))],
      ['x-internal-token (podvržený)', new RegExp(FAKE_INTERNAL)],
      ['x-user-id (podvržený)', new RegExp(FORGED_USER)],
    ];
    if (INTERNAL) forbidden.push(['INTERNAL_SERVICE_TOKEN', new RegExp(INTERNAL.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))]);
    const found: string[] = [];
    for (const [label, re] of forbidden) {
      const n = bodies.filter((b) => re.test(b)).length;
      if (n) found.push(`${label}: ${n} obálek`);
    }
    // hlavičky a cookies v událostech; atributy spanů s hlavičkami / cookies / uživatelem
    const SENSITIVE_HEADER = /^(authorization|cookie|x-internal-token|x-user-id)$/i;
    for (const i of all) {
      const req = i.raw.request as { headers?: Record<string, unknown>; cookies?: Record<string, unknown>; data?: unknown } | undefined;
      for (const k of Object.keys(req?.headers ?? {})) if (SENSITIVE_HEADER.test(k)) found.push(`hlavička ${k} v ${i.item_type ?? 'event'}`);
      if (req?.cookies && Object.keys(req.cookies).length) found.push(`request.cookies ${JSON.stringify(Object.keys(req.cookies))}`);
      if (req?.data !== undefined) found.push(`request.data (tělo) v ${i.item_type ?? 'event'}`);
      const user = i.raw.user as Record<string, unknown> | undefined;
      if (user && Object.keys(user).some((k) => k !== 'id')) found.push(`(e) user ${JSON.stringify(Object.keys(user))}`);
      const spans = i.item_type === 'span' ? ((i.raw.items as Array<{ attributes?: Record<string, unknown> }> | undefined) ?? [])
        : ((i.raw.spans as Array<{ data?: Record<string, unknown> }> | undefined) ?? []).map((s) => ({ attributes: s.data }));
      for (const s of spans) {
        for (const k of Object.keys(s.attributes ?? {})) {
          if (/header[._](authorization|cookie|x[-_]internal[-_]token|x[-_]user[-_]id)/i.test(k) || /^http\.request\.cookie/i.test(k)) found.push(`atribut spanu ${k}`);
          if (/^user\./.test(k) && k !== 'user.id') found.push(`(e) atribut spanu ${k}`);
          if (/body|request\.data/i.test(k) && !/size$/i.test(k)) found.push(`atribut spanu (tělo) ${k}`);
        }
      }
    }
    note(`(d)+(e) nálezy: ${found.length ? [...new Set(found)].join('; ') : 'žádné'}`);
    expect.soft([...new Set(found)], '(d)+(e) osobní údaje v obálkách').toEqual([]);
  });
});
