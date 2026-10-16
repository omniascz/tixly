/**
 * Kolo 21 / krok 2 — tokeny z URL (hlavička Referer, parametry dotazu) se nesmí dostat do Sentry.
 *
 * Vada (obálky simulátoru Kola 20): serverové spany nesou atribut `http.request.header.referer` s celou URL včetně dotazu,
 * např. `/cs/reset-password?token=…` (token pro obnovu hesla = převzetí účtu) a `/cs/events/<id>/seats/kategorie?token=…`
 * (token rezervace míst). scrub-pii.ts ho nemazal.
 *
 * Skutečné SDK (@sentry/nextjs v aplikaci, žádný mock) → obálky přes HTTP do simulátoru e2e/load/r14-fake-sentry.mjs.
 *   (a) obnova hesla jako golden-path-r16-prehydration (token z e-mailu v Mailpitu): otevře /cs/reset-password?token=<token>
 *       a z ní odešle formulář nového hesla (serverový požadavek s hlavičkou Referer);
 *   (b) výběr místa až na /cs/events/<id>/seats/kategorie?token=<token>&seats=… — stránka sama volá
 *       /api/public/events/<id>/seat-prices (serverový požadavek s hlavičkou Referer);
 *   (c) serverová chyba (POST /api/ops/sentry-check → 500, jako golden-path-r19-sentry11) s ?token=<hodnota> v URL
 *       a v hlavičce Referer; hodnotu si test vygeneruje.
 * Kritérium: v SUROVÝCH obálkách (<R21_SIM_OUT>.raw.jsonl) z běhu se hodnota žádného z tokenů (a)–(c) nevyskytuje
 * (ani URL-kódovaná); obálky dorazily (spany > 0, spany s cestou /cs/reset-password i /seats/kategorie, událost z (c) ≥ 1),
 * jinak test selže, aby neprošel naprázdno. Cesta URL bez dotazu v obálkách zůstat smí.
 * Prostředí (logs/r21/golden.sh): next start :3200 nad DB z migrací (create.sh --local, tixly_app + RLS), simulátor Sentry
 * :3995 (výstup R21_SIM_OUT), SENTRY_DSN = http://…@127.0.0.1:3995/1, Mailpit. Spany vzniknou vždy: hlavička sentry-trace
 * s příznakem sampled=1 (tracesSampleRate se nemění). Prohlížeč smí jen na localhost/127.0.0.1.
 */
import { existsSync, readFileSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import { expect, test, type Browser, type BrowserContext, type Page } from '@playwright/test';

const BASE = process.env.BASE_URL ?? 'http://localhost:3200';
const SIM = process.env.R19_SIM ?? 'http://127.0.0.1:3995';
const SIM_OUT = process.env.R21_SIM_OUT ?? '';
const MAILPIT = process.env.MAILPIT ?? 'http://localhost:58225';
const CRON = process.env.CRON_SECRET ?? '';
// demo termín Hamlet, Městské divadlo Brno (scripts/staging/seed-demo.sql) — bez blokací (jako golden-path-r20-order-confirmation)
const TERM = '00000000-0000-4000-a000-000000000503';
const RUN = Date.now().toString(36);
const PASS = 'UrlTokeny2026!x';
const BUYER = `r21-kupec-${RUN}@test.cz`;
const ipFor = (): string => `10.${16 + Math.floor(Math.random() * 200)}.${Math.floor(Math.random() * 250)}.${1 + Math.floor(Math.random() * 250)}`;
const hex = (n: number): string => Array.from({ length: n }, () => Math.floor(Math.random() * 16).toString(16)).join('');
const mask = (t: string): string => `${t.slice(0, 4)}…`;

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

const log: string[] = [];
const note = (s: string): void => { log.push(s); console.log(`[r21] ${s}`); };
const TOKENS: Record<'a' | 'b' | 'c', string> = { a: '', b: '', c: '' };

/** Kontext prohlížeče: jen localhost, sentry-trace sampled=1 → server navzorkuje každý požadavek (spany vždy). */
async function sampledContext(browser: Browser): Promise<{ ctx: BrowserContext; page: Page; blocked: string[] }> {
  const ctx = await browser.newContext({ baseURL: BASE, viewport: { width: 1440, height: 900 } });
  await ctx.setExtraHTTPHeaders({ 'x-real-ip': ipFor(), 'sentry-trace': `${hex(32)}-${hex(16)}-1` });
  await ctx.addInitScript(() => { try { window.localStorage.setItem('tixly.cookie-consent', JSON.stringify({ essential: true, analytics: false, marketing: false, decidedAt: '2026-10-15T00:00:00.000Z' })); } catch { /* */ } });
  const blocked: string[] = [];
  await ctx.route('**/*', (route) => {
    const u = new URL(route.request().url());
    if (u.hostname === 'localhost' || u.hostname === '127.0.0.1') return route.continue();
    blocked.push(u.host);
    return route.abort();
  });
  const page = await ctx.newPage();
  page.on('dialog', (d) => void d.dismiss());
  return { ctx, page, blocked };
}

/** Všechny řetězce v JSONu s cestou (indexy polí sloučené jako []), pro výpis, kde se token našel. */
function stringsWithPath(v: unknown, path: string, out: Array<[string, string]>): void {
  if (typeof v === 'string') out.push([path, v]);
  else if (Array.isArray(v)) v.forEach((x) => stringsWithPath(x, `${path}[]`, out));
  else if (v && typeof v === 'object') for (const [k, x] of Object.entries(v)) stringsWithPath(x, path ? `${path}.${k}` : k, out);
}

test.beforeAll(async ({ request }) => {
  expect(SIM_OUT, 'R21_SIM_OUT').not.toBe('');
  expect((await request.get(`${SIM}/_events`)).status()).toBe(200);
  expect(CRON.length, 'CRON_SECRET').toBeGreaterThan(0);
  const r = await request.post(`${BASE}/api/auth/register`, { data: { email: BUYER, password: PASS, name: 'Kupec Kola 21' }, headers: { origin: BASE, 'x-real-ip': ipFor() } });
  expect(r.status(), await r.text()).toBe(200);
});

// Jeden test, každý bod je krok s měkkou kontrolou — vyhodnotí se všechny body i když některý selže (RED doloží všechny).
test('Sentry: tokeny z URL (referer, dotaz) neodejdou — (a) obnova hesla, (b) výběr míst, (c) serverová chyba', async ({ request, browser }) => {
  test.setTimeout(240_000);

  await test.step('(a) /cs/reset-password?token=<token z e-mailu> → odeslání nového hesla', async () => {
    const fp = await request.post(`${BASE}/api/auth/forgot-password`, { data: { email: BUYER }, headers: { origin: BASE, 'x-real-ip': ipFor() } });
    expect(fp.status(), await fp.text()).toBe(200);
    let link = '';
    await expect.poll(async () => {
      const list = await (await fetch(`${MAILPIT}/api/v1/search?query=${encodeURIComponent(`to:${BUYER}`)}`)).json() as { messages?: Array<{ ID: string }> };
      for (const m of list.messages ?? []) {
        const msg = await (await fetch(`${MAILPIT}/api/v1/message/${m.ID}`)).json() as { Text?: string; HTML?: string };
        const hit = `${msg.Text ?? ''} ${msg.HTML ?? ''}`.match(/https?:\/\/[^\s"'<>]+reset-password\?token=[^\s"'<>&]+/);
        if (hit) { link = hit[0]; return true; }
      }
      return false;
    }, { timeout: 60_000 }).toBe(true);
    TOKENS.a = new URL(link).searchParams.get('token') ?? '';
    expect(TOKENS.a.length, '(a) token z e-mailu').toBeGreaterThan(16);
    const { ctx, page, blocked } = await sampledContext(browser);
    await page.goto(`/cs/reset-password?token=${encodeURIComponent(TOKENS.a)}`, { waitUntil: 'domcontentloaded' });
    await page.locator('#rp-pw').fill(`${PASS}N`);
    await page.locator('#rp-pw2').fill(`${PASS}N`);
    const [res] = await Promise.all([
      page.waitForResponse((r) => r.url().endsWith('/api/auth/reset-password') && r.request().method() === 'POST', { timeout: 60_000 }),
      page.locator('button[type="submit"]').click(),
    ]);
    note(`(a) token ${mask(TOKENS.a)} (${TOKENS.a.length} znaků); POST /api/auth/reset-password → ${res.status()}; Referer ${(await res.request().headerValue('referer'))?.replace(TOKENS.a, mask(TOKENS.a))}`);
    expect.soft(res.status(), '(a) nové heslo nastaveno').toBe(200);
    await page.waitForLoadState('networkidle', { timeout: 30_000 }).catch(() => {});
    await ctx.close();
    expect(blocked, '(a) prohlížeč jen na localhost').toEqual([]);
  });

  await test.step('(b) /cs/events/<id>/seats/kategorie?token=<rezervace>&seats=… → seat-prices', async () => {
    const { ctx, page, blocked } = await sampledContext(browser);
    await page.goto(`/cs/events/${TERM}/seats`);
    await page.locator('svg[aria-label="Plán sálu"]').first().waitFor();
    await page.locator('svg[aria-label="Plán sálu"] [aria-label^="Sektor "]').first().waitFor({ timeout: 20_000 });
    const free = page.locator('[aria-label^="Sektor Přízemí, řada "][aria-label$=", available"]');
    if (!(await free.count())) await page.locator('[aria-label^="Sektor Přízemí, dostupných"]').first().click();
    await free.first().click();
    const prices = page.waitForResponse((r) => /\/api\/public\/events\/[^/]+\/seat-prices/.test(r.url()), { timeout: 30_000 });
    await page.getByRole('button', { name: /Pokračovat na pokladnu/ }).click();
    await page.waitForURL(/\/seats\/kategorie\?/);
    const res = await prices;
    TOKENS.b = new URL(page.url()).searchParams.get('token') ?? '';
    expect(TOKENS.b.length, '(b) token rezervace v URL').toBeGreaterThan(8);
    note(`(b) token ${mask(TOKENS.b)} (${TOKENS.b.length} znaků); GET seat-prices → ${res.status()}; Referer ${(await res.request().headerValue('referer'))?.replace(TOKENS.b, mask(TOKENS.b))}`);
    expect.soft(res.status(), '(b) seat-prices').toBe(200);
    await page.waitForLoadState('networkidle', { timeout: 30_000 }).catch(() => {});
    await ctx.close();
    expect(blocked, '(b) prohlížeč jen na localhost').toEqual([]);
  });

  await test.step('(c) serverová chyba s ?token= v URL i v hlavičce Referer', async () => {
    TOKENS.c = `r21c${randomBytes(16).toString('hex')}`;
    const res = await request.post(`${BASE}/api/ops/sentry-check?token=${TOKENS.c}&lang=cs`, {
      headers: {
        'sentry-trace': `${hex(32)}-${hex(16)}-1`,
        authorization: `Bearer ${CRON}`,
        referer: `${BASE}/cs/reset-password?token=${TOKENS.c}#r21`,
        origin: BASE,
        'x-real-ip': ipFor(),
      },
      data: { r21: true },
    });
    note(`(c) token ${mask(TOKENS.c)}; POST /api/ops/sentry-check?token=… → ${res.status()}`);
    expect.soft(res.status()).toBe(500);
  });

  await test.step('obálky: žádný token z (a)–(c); obálky z (a)–(c) dorazily', async () => {
    const evC = await waitForEvent((i) => exceptionOf(i).startsWith('Sentry kontrola'));
    await new Promise((r) => setTimeout(r, 8000)); // dávky spanů
    const bodies = rawBodies();
    const all = items();
    const spanItems = all.filter((i) => i.item_type === 'span').flatMap((i) => (i.raw.items as Array<Record<string, unknown>> | undefined) ?? []);
    const spanText = spanItems.map((s) => JSON.stringify(s));
    const withPath = (p: RegExp): number => spanText.filter((s) => p.test(s)).length;
    note(`obálek: ${bodies.length}; spanů: ${spanItems.length}; událostí (event): ${all.filter((i) => !i.item_type && i.raw.type !== 'transaction').length}`);
    note(`spany s cestou /cs/reset-password: ${withPath(/\/cs\/reset-password/)}; se /seats/kategorie: ${withPath(/\/seats\/kategorie/)}; událost (c): ${evC ? 'ano' : 'NEDORAZILA'}`);
    expect.soft(spanItems.length, 'spany v obálkách').toBeGreaterThan(0);
    expect.soft(withPath(/\/cs\/reset-password/), '(a) spany s cestou /cs/reset-password dorazily').toBeGreaterThan(0);
    expect.soft(withPath(/\/seats\/kategorie/), '(b) spany s cestou /seats/kategorie dorazily').toBeGreaterThan(0);
    expect.soft(evC, '(c) událost dorazila').toBeTruthy();

    for (const k of ['a', 'b', 'c'] as const) {
      const tok = TOKENS[k];
      expect(tok.length, `token (${k}) zjištěn`).toBeGreaterThan(8);
      const variants = [...new Set([tok, encodeURIComponent(tok), encodeURIComponent(encodeURIComponent(tok))])];
      const hits = bodies.filter((b) => variants.some((v) => b.includes(v))).length;
      // kde: atribut spanu / pole události
      const where: Record<string, number> = {};
      for (const i of all) {
        const roots: Array<[string, unknown]> = i.item_type === 'span'
          ? ((i.raw.items as Array<{ name?: string; attributes?: Record<string, unknown> }> | undefined) ?? []).flatMap((s) => [['span.name', s.name] as [string, unknown], ...Object.entries(s.attributes ?? {}).map(([a, v]) => [`span.attributes.${a}`, v] as [string, unknown])])
          : [[i.raw.type === 'transaction' ? 'transaction' : 'event', i.raw]];
        for (const [base, v] of roots) {
          const strs: Array<[string, string]> = [];
          stringsWithPath(v, base, strs);
          for (const [p, s] of strs) if (variants.some((x) => s.includes(x))) where[p.replace(/\.value(\[\])?$/, '')] = (where[p.replace(/\.value(\[\])?$/, '')] ?? 0) + 1;
        }
      }
      note(`(${k}) token ${mask(tok)}: surových obálek s tokenem ${hits}; výskyty podle pole ${JSON.stringify(where)}`);
      expect.soft(hits, `(${k}) token v surových obálkách`).toBe(0);
    }
  });
});
