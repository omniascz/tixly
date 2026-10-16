/**
 * Kolo 23 / krok 1 — platba Wero jen tam, kde je mock brána povolená.
 *
 * Vada: /cs/checkout nabízel volbu „Wero — A2A Instant" vždy. Wero má jen mock bránu (lib/payment/provider.ts →
 * assertMockPaymentsAllowed), která v produkci (NODE_ENV=production bez ALLOW_MOCK_PAYMENTS=1) vyhodí výjimku — a to až
 * po COMMITu objednávky v POST /api/checkout. Kupec dostal 500, nezaplacená objednávka zůstala v DB a držela místa.
 *
 * Běží proti lokálnímu `next start` (BASE_URL, výchozí http://localhost:3200, tedy NODE_ENV=production) nad demo DB
 * z migrací (scripts/staging/create.sh --local, aplikace pod tixly_app + RLS), simulátor GoPay :3998. Nic se nemockuje:
 * stránka, GET /api/events/<id>/ticket-types, podržení místa i POST /api/checkout jdou na skutečné API aplikace.
 * Každý požadavek prohlížeče na jiného hostitele než localhost/127.0.0.1 se zaznamená a zahodí (route.abort()).
 *
 * Dvě konfigurace serveru (postupně, výběr testu přes --grep):
 *   (P) bez ALLOW_MOCK_PAYMENTS — produkčně:
 *     (a1) volby Karta (gopay) a Převodem (bank_transfer) viditelné; (a2) žádný input[value="wero"] ani text „Wero"
 *          (po odpovědi GET /api/events/<id>/ticket-types);
 *     (b1) POST /api/checkout s paymentMethod "wero" → 503 PAYMENT_METHOD_UNAVAILABLE; (b2) pro e-mail kupce žádná objednávka
 *          (orders.orders, čtení pod tixly_app v transakci s RLS kontextem promotéra akce); (b3) remainingQty typu vstupenky
 *          a stav podrženého místa před = po;
 *     pojistka: kontrolní objednávka přes stránku s gopay (jiný e-mail) → 200 s gatewayUrl a 1 objednávka v DB.
 *   (D) ALLOW_MOCK_PAYMENTS=1 — řízené demo:
 *     (c) Wero viditelné (input, text, po výběru nápověda) a POST /api/checkout s "wero" → 200, provider mock-wero,
 *         gatewayUrl /mock-wero/….
 * Tělo POST pro (b)/(c) = tělo, které stránka skutečně poslala (zachycené z requestu), jen s jiným místem, e-mailem a metodou.
 * Snímky sekce „Platební metoda" do R23_SHOTS (štítek R23_SHOT_TAG).
 */
import { createRequire } from 'node:module';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test, type Browser, type BrowserContext, type Page } from '@playwright/test';

const BASE = process.env.BASE_URL ?? 'http://localhost:3200';
const OWNER_URL = process.env.AUDIT_OWNER_URL ?? '';
const SHOTS = process.env.R23_SHOTS ?? '';
const SHOT_TAG = process.env.R23_SHOT_TAG ?? 'run';
// demo termín Hamlet, Divadlo Petra Bezruče (scripts/staging/seed-demo.sql), pořadatel = demo agentura
const TERM = '00000000-0000-4000-a000-000000000504';
const PROMOTER = '00000000-0000-4000-a000-000000000002';
const RUN = Date.now().toString(36);
const ipFor = (): string => `10.${16 + Math.floor(Math.random() * 200)}.${Math.floor(Math.random() * 250)}.${1 + Math.floor(Math.random() * 250)}`;

// pg z knihovny aplikace (žádné nové závislosti)
const appRequire = createRequire(join(__dirname, '..', '..', 'nextjs-boilerplate', 'package.json'));
const { Pool } = appRequire('pg') as typeof import('pg');

const note = (s: string): void => { console.log(`[r23] ${s}`); };

interface Outbound { host: string; path: string }
interface Seat { id: string; status: string; ttId: string; sector: string; row: string; num: string }

/** Kontext prohlížeče: požadavky mimo localhost/127.0.0.1 se zaznamenají a zahodí (route.abort) před odesláním. */
async function guardedContext(browser: Browser): Promise<{ ctx: BrowserContext; page: Page; out: Outbound[] }> {
  const ctx = await browser.newContext({ baseURL: BASE, viewport: { width: 1280, height: 900 } });
  await ctx.setExtraHTTPHeaders({ 'x-real-ip': ipFor() });
  await ctx.addInitScript(() => { try { window.localStorage.setItem('tixly.cookie-consent', JSON.stringify({ essential: true, analytics: false, marketing: false, decidedAt: '2026-10-16T00:00:00.000Z' })); } catch { /* */ } });
  const out: Outbound[] = [];
  await ctx.route('**/*', (route) => {
    const u = new URL(route.request().url());
    if (u.hostname === 'localhost' || u.hostname === '127.0.0.1') return route.continue();
    out.push({ host: u.host, path: u.pathname });
    return route.abort();
  });
  const page = await ctx.newPage();
  page.on('dialog', (d) => void d.dismiss());
  return { ctx, page, out };
}

/** Počet objednávek kupce (e-mail) na termínu — tixly_app, transakce s RLS kontextem promotéra akce (jako live testy). */
async function ordersFor(email: string): Promise<number> {
  expect(OWNER_URL, 'AUDIT_OWNER_URL (DB demo prostředí)').not.toBe('');
  const appUrl = OWNER_URL.replace(/\/\/[^@]+@/, '//tixly_app:fixapp@');
  const pool = new Pool({ connectionString: appUrl, max: 1 });
  const cl = await pool.connect();
  try {
    await cl.query('BEGIN');
    await cl.query(
      `SELECT set_config('app.current_promoter_id',$1,true), set_config('app.current_user_id','',true),
              set_config('app.role','promoter',true), set_config('app.is_platform_admin','',true)`,
      [PROMOTER],
    );
    const who = await cl.query<{ u: string; bypass: boolean }>(`SELECT current_user AS u, (SELECT rolbypassrls FROM pg_roles WHERE rolname = current_user) AS bypass`);
    expect(who.rows[0], 'čtení pod tixly_app bez BYPASSRLS').toEqual({ u: 'tixly_app', bypass: false });
    const r = await cl.query<{ n: string }>(
      `SELECT count(*)::text AS n FROM orders.orders o JOIN identity.users u ON u.id = o.user_id
        WHERE lower(u.email) = lower($1) AND o.event_id = $2`,
      [email, TERM],
    );
    return Number(r.rows[0].n);
  } finally {
    await cl.query('ROLLBACK').catch(() => {});
    cl.release();
    await pool.end();
  }
}

/** Volné místo termínu ze skutečného API (zdroj plánku sálu) a jeho podržení (POST …/seats/hold, jako SeatPicker). */
async function holdSeat(ctx: BrowserContext, label: string): Promise<{ seat: Seat; holdToken: string }> {
  const res = await ctx.request.get(`${BASE}/api/events/${TERM}/seats`);
  expect(res.status(), 'GET seats').toBe(200);
  const { seats } = (await res.json()) as { seats: Seat[] };
  const free = seats.filter((s) => s.status === 'available');
  expect(free.length, 'volná místa').toBeGreaterThan(0);
  const seat = free[Math.floor(Math.random() * free.length)];
  const hold = await ctx.request.post(`${BASE}/api/events/${TERM}/seats/hold`, { data: { seatIds: [seat.id] }, headers: { 'x-fingerprint': `r23-${RUN}-${label}` } });
  expect(hold.status(), 'hold').toBe(200);
  const { holdToken } = (await hold.json()) as { holdToken: string };
  note(`${label}: místo ${seat.sector} ř. ${seat.row} č. ${seat.num} podrženo`);
  return { seat, holdToken };
}

/** Dostupnost: remainingQty typu vstupenky (GET ticket-types) a stav místa (GET seats). */
async function availability(ctx: BrowserContext, ttId: string, seatId: string): Promise<{ remainingQty: number | null; seatStatus: string | null }> {
  const tt = (await (await ctx.request.get(`${BASE}/api/events/${TERM}/ticket-types`)).json()) as { ticketTypes: Array<{ id: string; remainingQty: number }> };
  const st = (await (await ctx.request.get(`${BASE}/api/events/${TERM}/seats`)).json()) as { seats: Seat[] };
  return { remainingQty: tt.ticketTypes.find((t) => t.id === ttId)?.remainingQty ?? null, seatStatus: st.seats.find((s) => s.id === seatId)?.status ?? null };
}

/** Otevře /cs/checkout (URL jako ze SeatPickeru u termínu bez kategorií) a počká na odpověď GET ticket-types. */
async function openCheckout(page: Page, seat: Seat, holdToken: string): Promise<void> {
  const q = new URLSearchParams({ eventId: TERM, ticketTypeId: seat.ttId, seatHoldToken: holdToken, seatIds: seat.id, quantity: '1' });
  const tt = page.waitForResponse((r) => r.url().endsWith(`/api/events/${TERM}/ticket-types`) && r.request().method() === 'GET', { timeout: 60_000 });
  await page.goto(`/cs/checkout?${q.toString()}`, { waitUntil: 'domcontentloaded' });
  const res = await tt;
  expect(res.status(), 'GET ticket-types ze stránky').toBe(200);
  await res.finished();
  // stav z odpovědi se aplikuje v .then() — po dvou snímcích je vykreslený
  await page.evaluate(() => new Promise<void>((r) => requestAnimationFrame(() => requestAnimationFrame(() => r()))));
  await expect(page.locator('input[value="gopay"]'), 'checkout vykreslen (volba Karta)').toBeVisible({ timeout: 30_000 });
}

const paymentSection = (page: Page) => page.locator('fieldset', { has: page.locator('legend', { hasText: 'Platební metoda' }) });

async function shot(page: Page, name: string): Promise<void> {
  if (!SHOTS) return;
  mkdirSync(SHOTS, { recursive: true });
  await paymentSection(page).screenshot({ path: join(SHOTS, `1_${SHOT_TAG}_${name}.png`) });
  note(`snímek sekce „Platební metoda" ${SHOT_TAG}_${name}.png`);
}

/** Vyplní kupce a odešle stránku s gopay — vrátí tělo, které stránka poslala, a odpověď. */
async function submitGopay(page: Page, email: string): Promise<{ body: Record<string, unknown>; status: number; json: Record<string, unknown> }> {
  await page.locator('#checkout-name').fill('Kupec Kola 23');
  await page.locator('#checkout-email').fill(email);
  await page.locator('input[value="gopay"]').check();
  const [co] = await Promise.all([
    page.waitForResponse((r) => r.url().endsWith('/api/checkout') && r.request().method() === 'POST', { timeout: 60_000 }),
    page.getByRole('button', { name: /Pokračovat na platbu/ }).click(),
  ]);
  const body = co.request().postDataJSON() as Record<string, unknown>;
  const json = (await co.json().catch(() => ({}))) as Record<string, unknown>;
  return { body, status: co.status(), json };
}

/** Skutečný POST /api/checkout z prohlížeče na stránce aplikace (stejně jako fetch stránky). */
async function postCheckout(page: Page, body: Record<string, unknown>): Promise<{ status: number; json: Record<string, unknown> }> {
  return page.evaluate(async (b) => {
    const r = await fetch('/api/checkout', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(b) });
    let json: Record<string, unknown> = {};
    try { json = await r.json(); } catch { /* prázdné tělo */ }
    return { status: r.status, json };
  }, body);
}

test('(P) produkčně bez ALLOW_MOCK_PAYMENTS: Wero se nenabízí a API ho odmítne před založením objednávky', async ({ browser }) => {
  test.setTimeout(240_000);
  const { ctx, page, out } = await guardedContext(browser);
  const ctrlEmail = `r23-kontrola-${RUN}@test.cz`;
  const weroEmail = `r23-wero-${RUN}@test.cz`;

  // (a) UI pokladny
  const a = await holdSeat(ctx, '(a)');
  await openCheckout(page, a.seat, a.holdToken);
  const gopayVisible = await page.locator('input[value="gopay"]').isVisible();
  const bankVisible = await page.locator('input[value="bank_transfer"]').isVisible();
  const weroInputs = await page.locator('input[value="wero"]').count();
  const weroText = await page.getByText('Wero').count();
  note(`(a1) Karta viditelná: ${gopayVisible}, Převodem viditelná: ${bankVisible}`);
  note(`(a2) input[value="wero"]: ${weroInputs}, prvků s textem „Wero": ${weroText}`);
  await shot(page, 'P_default');
  expect.soft(gopayVisible, '(a1) Karta').toBe(true);
  expect.soft(bankVisible, '(a1) Převodem').toBe(true);
  expect.soft(weroInputs, '(a2) žádný input[value="wero"]').toBe(0);
  expect.soft(weroText, '(a2) žádný text „Wero"').toBe(0);

  // pojistka: kontrolní objednávka stránkou s gopay → 200 s gatewayUrl (zachycené tělo = tělo stránky)
  const ctrl = await submitGopay(page, ctrlEmail);
  note(`pojistka: POST /api/checkout (gopay, stránka) → ${ctrl.status}, gatewayUrl ${String(ctrl.json.gatewayUrl ?? '—').replace(/\?.*$/, '?…')}`);
  expect(ctrl.status, `kontrolní gopay ${String(ctrl.json.error ?? '')} ${String(ctrl.json.message ?? '')}`).toBe(200);
  expect(String(ctrl.json.gatewayUrl ?? ''), 'kontrolní gopay gatewayUrl').toMatch(/^http:\/\/localhost:3998\/gw\//);
  const ctrlOrders = await ordersFor(ctrlEmail);
  note(`pojistka: objednávek kontrolního kupce v DB: ${ctrlOrders}`);
  expect(ctrlOrders, 'kontrolní objednávka je v DB vidět (dotaz pro (b2) funguje)').toBe(1);
  note(`tělo stránky (klíče): ${Object.keys(ctrl.body).sort().join(', ')}`);

  // (b) API: stejné tělo, jiné místo a e-mail, paymentMethod "wero"
  const b = await holdSeat(ctx, '(b)');
  await openCheckout(page, b.seat, b.holdToken);
  const body = {
    ...ctrl.body, ticketTypeId: b.seat.ttId, seatHoldToken: b.holdToken, seatIds: Array.isArray(ctrl.body.seatIds) ? [b.seat.id] : b.seat.id,
    buyerEmail: weroEmail, paymentMethod: 'wero',
  };
  expect(Object.keys(body).sort(), 'tělo (b) má stejné klíče jako tělo stránky').toEqual(Object.keys(ctrl.body).sort());
  const before = await ordersFor(weroEmail);
  const avBefore = await availability(ctx, b.seat.ttId, b.seat.id);
  const res = await postCheckout(page, body);
  const after = await ordersFor(weroEmail);
  const avAfter = await availability(ctx, b.seat.ttId, b.seat.id);
  note(`(b1) POST /api/checkout (wero) → ${res.status}, error=${String(res.json.error ?? '—')}, message=${String(res.json.message ?? '—')}, provider=${String(res.json.provider ?? '—')}, orderId=${res.json.orderId ? 'ano' : 'ne'}`);
  note(`(b2) objednávek kupce (wero) před: ${before}, po: ${after}`);
  note(`(b3) dostupnost před: ${JSON.stringify(avBefore)}, po: ${JSON.stringify(avAfter)}`);
  expect.soft(res.status, '(b1) stavový kód').toBe(503);
  expect.soft(res.json.error, '(b1) error').toBe('PAYMENT_METHOD_UNAVAILABLE');
  expect.soft([before, after], '(b2) objednávek před/po').toEqual([0, 0]);
  expect.soft(avAfter, '(b3) dostupnost po = před').toEqual(avBefore);

  note(`zahozených požadavků mimo localhost: ${out.length} ${JSON.stringify(out.map((o) => o.host))}`);
  await ctx.close();
});

test('(D) řízené demo ALLOW_MOCK_PAYMENTS=1: Wero se nabízí a vede na mock-wero', async ({ browser }) => {
  test.setTimeout(240_000);
  const { ctx, page, out } = await guardedContext(browser);
  const weroEmail = `r23-demo-wero-${RUN}@test.cz`;

  const a = await holdSeat(ctx, '(c)');
  await openCheckout(page, a.seat, a.holdToken);
  const wero = page.locator('input[value="wero"]');
  await expect(wero, '(c) input[value="wero"] viditelný').toBeVisible({ timeout: 30_000 });
  await expect(page.locator('input[value="bank_transfer"]'), '(c) Převodem viditelná').toBeVisible();
  const weroText = await page.getByText('Wero', { exact: false }).count();
  note(`(c) input[value="wero"] viditelný; prvků s textem „Wero": ${weroText}`);
  expect(weroText, '(c) text „Wero"').toBeGreaterThan(0);
  await shot(page, 'D_default');
  await wero.check();
  const hint = page.getByText('Wero — okamžitá platba z účtu');
  await expect(hint, '(c) nápověda po výběru').toBeVisible();
  note('(c) po výběru Wero nápověda „Wero — okamžitá platba z účtu" viditelná');
  await shot(page, 'D_wero_selected');

  // skutečné odeslání stránkou s Wero → tělo stránky a odpověď API
  await page.locator('#checkout-name').fill('Kupec Kola 23');
  await page.locator('#checkout-email').fill(weroEmail);
  const [co] = await Promise.all([
    page.waitForResponse((r) => r.url().endsWith('/api/checkout') && r.request().method() === 'POST', { timeout: 60_000 }),
    page.getByRole('button', { name: /Pokračovat na platbu/ }).click(),
  ]);
  const sent = co.request().postDataJSON() as Record<string, unknown>;
  const json = (await co.json().catch(() => ({}))) as Record<string, unknown>;
  note(`(c) POST /api/checkout (wero, stránka; paymentMethod v těle: ${String(sent.paymentMethod)}) → ${co.status()}, provider=${String(json.provider ?? '—')}, gatewayUrl=${String(json.gatewayUrl ?? '—').replace(/mock-pay-.*/, 'mock-pay-…')}`);
  expect(sent.paymentMethod, '(c) stránka poslala wero').toBe('wero');
  expect(co.status(), `(c) stav ${String(json.error ?? '')} ${String(json.message ?? '')}`).toBe(200);
  expect(json.provider, '(c) provider').toBe('mock-wero');
  expect(String(json.gatewayUrl ?? ''), '(c) gatewayUrl').toMatch(/^\/mock-wero\//);
  await page.waitForURL(/\/mock-wero\//, { timeout: 30_000 });
  note(`(c) stránka přešla na ${new URL(page.url()).pathname.replace(/mock-pay-.*/, 'mock-pay-…')}`);
  const orders = await ordersFor(weroEmail);
  note(`(c) objednávek kupce (wero) v DB: ${orders}`);
  expect(orders, '(c) objednávka založena').toBe(1);

  note(`zahozených požadavků mimo localhost: ${out.length} ${JSON.stringify(out.map((o) => o.host))}`);
  await ctx.close();
});
