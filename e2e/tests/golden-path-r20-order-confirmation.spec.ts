/**
 * Kolo 20 / krok 1 — stránka potvrzení objednávky /[locale]/order-confirmation/[orderId] se zaplacenou objednávkou.
 *
 * Vada (od kola 10 v logu serveru): `order.event_date_start` přichází z ovladače pg jako `Date`, odkaz „Přidat do Google
 * Kalendáře" na něm volal `.replace(...)` → render zaplacené objednávky padal (`TypeError: d.event_date_start.replace is not
 * a function`).
 *
 * Běží proti lokálnímu `next start` (BASE_URL, výchozí http://localhost:3200) nad demo DB z migrací (scripts/staging/create.sh
 * --local, aplikace pod tixly_app + RLS), simulátor GoPay :3998 (platební stránka /gw/:id). Nic nejde mimo localhost.
 * Nic se nemockuje: objednávku založí a zaplatí kupec v prohlížeči, stránku vykreslí server ze skutečné DB.
 *
 *   (a) zaplacená objednávka: HTTP 200, v HTML číslo objednávky, žádná chybová stránka
 *   (b) v logu serveru (R20_SERVER_LOG) za dobu testu žádný TypeError
 *   (c) odkaz calendar.google.com: `dates` = začátek termínu v UTC ve tvaru YYYYMMDDTHHMMSSZ podle date_start z DB
 *   (d) nezaplacená objednávka: stránka 200, odkaz se nevykreslí
 *   (null) objednávka bez termínu (event_id NULL → event_date_start NULL; catalog.events.date_start je NOT NULL, jinak
 *          nastat nemůže): stránka 200, odkaz se nevykreslí
 */
import { existsSync, readFileSync, statSync } from 'node:fs';
import { expect, test, type Browser, type BrowserContext, type Page } from '@playwright/test';
import pg from 'pg';

const BASE = process.env.BASE_URL ?? 'http://localhost:3200';
const OWNER_URL = process.env.AUDIT_OWNER_URL ?? 'postgresql://neondb_owner:fixowner@localhost:55632/r20demo';
const SERVER_LOG = process.env.R20_SERVER_LOG ?? '';
// demo termín Hamlet, Městské divadlo Brno (scripts/staging/seed-demo.sql) — bez blokací
const TERM = '00000000-0000-4000-a000-000000000503';
const RUN = Date.now().toString(36);
const RUN_IP = `10.${Math.floor(Math.random() * 250)}.${Math.floor(Math.random() * 250)}.${Math.floor(Math.random() * 250) + 1}`;

// testy jsou na sobě nezávislé (po selhání (a) na starém kódu proběhnou i (d) a (null))

let db: pg.Client;
let logOffset = 0;
const S = { paidOrder: '', pendingOrder: '', paidEmail: `r20-paid-${RUN}@tixly.test`, pendingEmail: `r20-pending-${RUN}@tixly.test` };

const q = async <T = Record<string, unknown>>(sql: string, params: unknown[] = []): Promise<T[]> =>
  (await db.query(sql, params)).rows as T[];

/** Nové řádky logu serveru od začátku testu. */
function serverLogSinceStart(): string {
  if (!SERVER_LOG || !existsSync(SERVER_LOG)) return '';
  return readFileSync(SERVER_LOG).subarray(logOffset).toString('utf8');
}

async function buyerContext(browser: Browser): Promise<{ ctx: BrowserContext; page: Page }> {
  const ctx = await browser.newContext({ baseURL: BASE });
  await ctx.setExtraHTTPHeaders({ 'x-real-ip': RUN_IP });
  await ctx.addInitScript(() => {
    try { window.localStorage.setItem('tixly.cookie-consent', JSON.stringify({ essential: true, analytics: false, marketing: false, decidedAt: new Date().toISOString() })); } catch { /* */ }
  });
  return { ctx, page: await ctx.newPage() };
}

async function buyerSeat(page: Page, sector: string, row: string, seat: string): Promise<void> {
  await page.locator('svg[aria-label="Plán sálu"]').first().waitFor();
  await page.locator('svg[aria-label="Plán sálu"] [aria-label^="Sektor "]').first().waitFor({ timeout: 20_000 });
  const label = `Sektor ${sector}, řada ${row}, sedadlo ${seat}, available`;
  let c = page.locator(`[aria-label="${label}"]`);
  if (!(await c.count())) {
    await page.locator(`[aria-label^="Sektor ${sector}, dostupných"]`).first().click();
    c = page.locator(`[aria-label="${label}"]`);
  }
  await c.first().click();
}

/** Kupec vybere místo a dojde na platební stránku simulátoru GoPay. Vrací id objednávky. */
async function checkoutToGateway(page: Page, seat: string, email: string): Promise<string> {
  await page.goto(`/cs/events/${TERM}/seats`);
  await buyerSeat(page, 'Přízemí', '3', seat);
  await page.getByRole('button', { name: /Pokračovat na pokladnu/ }).click();
  await page.waitForURL(/\/seats\/kategorie/);
  await page.getByPlaceholder('E-mail').fill(email);
  await page.getByPlaceholder('Jméno a příjmení').fill('Kupec Kola Dvacet');
  await page.getByRole('button', { name: 'Zaplatit' }).click();
  await page.waitForURL(/localhost:3998\/gw\//, { timeout: 20_000 });
  const rows = await q<{ id: string }>(
    `SELECT o.id FROM orders.orders o JOIN identity.users u ON u.id = o.user_id WHERE u.email = $1 ORDER BY o.created_at DESC LIMIT 1`, [email]);
  expect(rows).toHaveLength(1);
  return rows[0].id;
}

/** Začátek termínu objednávky z DB (pg vrací timestamptz jako Date) → formát Google Kalendáře v UTC. */
async function expectedGoogleStart(orderId: string): Promise<string> {
  const [r] = await q<{ date_start: Date }>(
    `SELECT e.date_start FROM orders.orders o JOIN catalog.events e ON e.id = o.event_id WHERE o.id = $1`, [orderId]);
  expect(r.date_start).toBeInstanceOf(Date);
  return r.date_start.toISOString().replace(/\.\d{3}Z$/, 'Z').replace(/[-:]/g, '');
}

async function openConfirmation(page: Page, orderId: string): Promise<{ status: number; html: string }> {
  const res = await page.goto(`/cs/order-confirmation/${orderId}`, { waitUntil: 'domcontentloaded' });
  expect(res).not.toBeNull();
  return { status: res!.status(), html: await res!.text() };
}

test.beforeAll(async () => {
  db = new pg.Client({ connectionString: OWNER_URL });
  await db.connect();
  if (SERVER_LOG && existsSync(SERVER_LOG)) logOffset = statSync(SERVER_LOG).size;
});
test.afterAll(async () => { await db?.end(); });

test('(a)(b)(c) zaplacená objednávka s termínem: stránka 200, číslo objednávky, odkaz do kalendáře v UTC', async ({ browser }) => {
  test.setTimeout(120_000);
  expect(SERVER_LOG, 'R20_SERVER_LOG musí ukazovat na log serveru').not.toBe('');
  const { ctx, page } = await buyerContext(browser);
  S.paidOrder = await checkoutToGateway(page, '5', S.paidEmail);
  await page.getByTestId('gw-pay').click();
  await page.waitForURL((u) => u.href.startsWith(BASE), { timeout: 20_000 });
  expect(page.url()).toContain(`/cs/order-confirmation/${S.paidOrder}`);
  await expect.poll(async () => (await q<{ status: string }>(`SELECT status FROM orders.orders WHERE id = $1`, [S.paidOrder]))[0].status,
    { timeout: 30_000 }).toBe('paid');

  // (a) kupec stránku potvrzení otevře znovu (po připsání platby)
  const { status, html } = await openConfirmation(page, S.paidOrder);
  console.log(`[r20] (a) GET /cs/order-confirmation/${S.paidOrder} → ${status}`);
  // expect.soft: (a), (b) i (c) se vyhodnotí všechny, i když jeden bod selže
  expect.soft(status).toBe(200);
  expect.soft(html).toContain(S.paidOrder);
  await expect.soft(page.locator('code', { hasText: S.paidOrder })).toBeVisible();
  await expect.soft(page.getByRole('heading', { name: /Hamlet/ })).toBeVisible();
  await expect.soft(page.getByText(/Application error|Something went wrong|Internal Server Error/i)).toHaveCount(0);

  // (c) odkaz do Google Kalendáře: dates = začátek/začátek (jako dosud), UTC, YYYYMMDDTHHMMSSZ, podle date_start z DB
  const link = page.locator('a[href^="https://calendar.google.com/"]');
  const want = await expectedGoogleStart(S.paidOrder);
  const links = await link.count();
  const dates = links === 1 ? new URL((await link.getAttribute('href'))!).searchParams.get('dates') ?? '' : '';
  console.log(`[r20] (c) odkazů calendar.google.com: ${links}; dates=${dates || '—'} očekáváno ${want}/${want}`);
  expect.soft(links).toBe(1);
  expect.soft(dates).toMatch(/^\d{8}T\d{6}Z\/\d{8}T\d{6}Z$/);
  expect.soft(dates).toBe(`${want}/${want}`);
  await ctx.close();

  // (b) log serveru bez TypeError (po vykreslení dát serveru chvíli na zápis)
  await new Promise((r) => setTimeout(r, 500));
  const log = serverLogSinceStart();
  const typeErrors = log.split(/\r?\n/).filter((l) => l.includes('TypeError'));
  console.log(`[r20] (b) řádků TypeError v logu serveru: ${typeErrors.length}${typeErrors.length ? ` — ${typeErrors[0].trim()}` : ''}`);
  expect.soft(typeErrors).toEqual([]);
});

test('(d) nezaplacená objednávka: stránka 200, odkaz do kalendáře se nevykreslí', async ({ browser }) => {
  test.setTimeout(90_000);
  const { ctx, page } = await buyerContext(browser);
  S.pendingOrder = await checkoutToGateway(page, '6', S.pendingEmail);
  // kupec nezaplatí — objednávka zůstane nezaplacená
  const [o] = await q<{ status: string }>(`SELECT status FROM orders.orders WHERE id = $1`, [S.pendingOrder]);
  expect(o.status).not.toBe('paid');
  const { status, html } = await openConfirmation(page, S.pendingOrder);
  console.log(`[r20] (d) objednávka ve stavu ${o.status}: GET → ${status}`);
  expect(status).toBe(200);
  expect(html).toContain(S.pendingOrder);
  await expect(page.locator('code', { hasText: S.pendingOrder })).toBeVisible();
  await expect(page.locator('a[href^="https://calendar.google.com/"]')).toHaveCount(0);
  await ctx.close();
});

test('(null) zaplacená objednávka bez termínu (event_date_start NULL): stránka 200, odkaz se nevykreslí', async ({ browser }) => {
  test.setTimeout(60_000);
  // Stejný tvar jako zaplacená objednávka bez akce z api/vouchers/holders/[paymentId]/confirm (event_id NULL).
  // Kupec = účet demo pořadatele ze seed-demo.sql (testy jsou nezávislé; objednávka bez akce nemá nákupní cestu v UI).
  const [u] = await q<{ id: string }>(`SELECT id FROM identity.users WHERE id = '00000000-0000-4000-a000-000000000001'`);
  expect(u?.id).toBeTruthy();
  const [o] = await q<{ id: string }>(
    `INSERT INTO orders.orders (user_id, status, total_amount, currency, expires_at, paid_at)
     VALUES ($1, 'paid', 50000, 'CZK', NOW() + INTERVAL '30 days', NOW()) RETURNING id`, [u.id]);
  const { ctx, page } = await buyerContext(browser);
  const { status, html } = await openConfirmation(page, o.id);
  console.log(`[r20] (null) GET /cs/order-confirmation/${o.id} → ${status}`);
  expect(status).toBe(200);
  expect(html).toContain(o.id);
  await expect(page.locator('code', { hasText: o.id })).toBeVisible();
  await expect(page.locator('a[href^="https://calendar.google.com/"]')).toHaveCount(0);
  await ctx.close();
  const typeErrors = serverLogSinceStart().split(/\r?\n/).filter((l) => l.includes('TypeError'));
  expect(typeErrors).toEqual([]);
});
