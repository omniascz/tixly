/**
 * Kolo 15 / krok 1 a 3 — screenshoty před a po upgradu Next 14 → 15 pro pixelové porovnání.
 * Stejných 22 obrazovek jako golden-path-r13-screens (administrace 1440, menu/pokladna/skener 390, web úvod/akce/místa
 * 1440+390) + veřejný web (program, inscenace, checkout) a skener v 1440 i 390 px. Jen čte (žádné zápisy), DB z
 * create.sh --local; výstup do SHOTS (logs/r15/before | after).
 */
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { test, type Browser, type Page } from '@playwright/test';
import pg from 'pg';

const BASE = process.env.BASE_URL ?? 'http://localhost:3200';
const SHOTS = process.env.SHOTS ?? '../logs/r15/before';
const OWNER_URL = process.env.AUDIT_OWNER_URL ?? 'postgresql://neondb_owner:fixowner@localhost:55632/r15demo';
const OWNER = { email: 'demo@tixly-staging.test', pass: 'Demo2026!heslo' };
const RBRNO = '00000000-0000-4000-a000-000000000501';
const PRODUCTION = '00000000-0000-4000-a000-000000000401';
const RUN_IP = `10.${Math.floor(Math.random() * 250)}.${Math.floor(Math.random() * 250)}.${Math.floor(Math.random() * 250) + 1}`;

test.describe.configure({ mode: 'serial' });
mkdirSync(SHOTS, { recursive: true });

async function open(browser: Browser, mobile: boolean, auth: boolean): Promise<Page> {
  const ctx = await browser.newContext(mobile
    ? { baseURL: BASE, viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true }
    : { baseURL: BASE, viewport: { width: 1440, height: 900 } });
  await ctx.setExtraHTTPHeaders({ 'x-real-ip': RUN_IP });
  await ctx.addInitScript(() => { try { window.localStorage.setItem('tixly.cookie-consent', JSON.stringify({ essential: true, analytics: false, marketing: false, decidedAt: '2026-10-06T00:00:00.000Z' })); } catch { /* */ } });
  const page = await ctx.newPage();
  page.on('dialog', (d) => void d.dismiss());
  if (auth) {
    await page.goto('/cs/login', { waitUntil: 'domcontentloaded' });
    // Vyplnit až po hydrataci: e-mail napsaný před ní React při dalším vykreslení (vyplnění hesla) smaže — stejně
    // v Next 14 i 15 (logs/r15/3_hydration_race.txt), jen časování se liší.
    await page.waitForLoadState('networkidle', { timeout: 20_000 }).catch(() => {});
    await page.getByLabel('E-mail').fill(OWNER.email);
    await page.getByLabel('Heslo').fill(OWNER.pass);
    await Promise.all([page.waitForResponse((r) => r.url().endsWith('/api/auth/login')), page.getByRole('button', { name: /^Přihlásit$/ }).click()]);
    await page.waitForURL(/\/admin(?!\/?login)/, { timeout: 20_000 });
  }
  return page;
}
async function shot(page: Page, path: string, name: string, prep?: (p: Page) => Promise<void>): Promise<void> {
  await page.goto(path, { waitUntil: 'domcontentloaded' });
  await page.waitForLoadState('networkidle', { timeout: 8000 }).catch(() => {});
  if (prep) await prep(page);
  await page.waitForTimeout(Number(process.env.SETTLE_MS ?? 800));
  await page.screenshot({ path: join(SHOTS, `${name}.png`), fullPage: true, animations: 'disabled', caret: 'hide' });
}
const seatsReady = async (p: Page): Promise<void> => { await p.locator('svg circle, button[aria-label*="řada"], [data-seat]').first().waitFor({ timeout: 8000 }).catch(() => {}); };

const ADMIN: Array<[string, string, ((p: Page) => Promise<void>)?]> = [
  ['/admin', '01-admin-menu'],
  ['/admin/events', '02-akce-seznam'],
  [`/admin/productions/${PRODUCTION}`, '03-inscenace-terminy'],
  [`/admin/events/${RBRNO}`, '04-termin'],
  ['/admin/venues/00000000-0000-4000-a000-000000000201/seating-chart/editor', '05-editor-planku', async (p) => { await p.locator('svg circle').first().waitFor({ timeout: 8000 }).catch(() => {}); }],
  [`/admin/events/${RBRNO}/blokace`, '06-blokace', async (p) => { await p.locator('svg circle').first().waitFor({ timeout: 8000 }).catch(() => {}); }],
  [`/admin/events/${RBRNO}/firemni`, '07-firemni'],
  ['/admin/promo-codes', '08-promo-kody'],
  [`/admin/events/${RBRNO}/reporty`, '09-reporty'],
  [`/admin/events/${RBRNO}/zruseni`, '10-zruseni-presun'],
  ['/admin/pos', '11-pokladna', async (p) => { await p.locator('#pos-event option').nth(1).waitFor({ state: 'attached', timeout: 8000 }).catch(() => {}); await p.locator('#pos-event').selectOption(RBRNO).catch(() => {}); await p.waitForTimeout(800); }],
  ['/admin/scanner', '12-skener'],
  ['/admin/venues', '13-saly'],
];

test('administrace — desktop 1440', async ({ browser }) => {
  test.setTimeout(240_000);
  const page = await open(browser, false, true);
  for (const [path, name, prep] of ADMIN) await shot(page, path, `${name}-1440`, prep);
  await page.context().close();
});

test('administrace — mobil 390 (menu, pokladna, skener)', async ({ browser }) => {
  test.setTimeout(180_000);
  const page = await open(browser, true, true);
  for (const [path, name, prep] of ADMIN.filter(([, n]) => /01-|11-|12-/.test(n))) await shot(page, path, `${name}-390`, prep);
  await page.context().close();
});

test('veřejný web — desktop a mobil', async ({ browser }) => {
  test.setTimeout(240_000);
  // checkout se vykreslí z parametrů URL (typ vstupenky + místo) — bez holdu, bez zápisu; ID z demo DB
  const db = new pg.Client({ connectionString: OWNER_URL });
  await db.connect();
  const tt = (await db.query<{ id: string }>(`SELECT id FROM catalog.ticket_types WHERE event_id = $1 ORDER BY name, id LIMIT 1`, [RBRNO])).rows[0]?.id ?? '';
  const seat = (await db.query<{ id: string }>(
    `SELECT id FROM catalog.event_seats WHERE event_id = $1 AND status = 'available'
      ORDER BY sector, "row", lpad(seat_number, 4, '0') LIMIT 1`,
    [RBRNO],
  )).rows[0]?.id ?? '';
  await db.end();
  const checkout = `/cs/checkout?eventId=${RBRNO}&ticketTypeId=${tt}&quantity=1${seat ? `&seatIds=${seat}` : ''}`;
  for (const mobile of [false, true]) {
    const page = await open(browser, mobile, false);
    const w = mobile ? 390 : 1440;
    await shot(page, '/cs', `20-web-uvod-${w}`);
    await shot(page, `/cs/events/${RBRNO}`, `21-web-akce-${w}`);
    await shot(page, `/cs/events/${RBRNO}/seats`, `22-web-mista-${w}`, seatsReady);
    await shot(page, '/cs/program', `23-web-program-${w}`);
    await shot(page, `/cs/inscenace/${PRODUCTION}`, `24-web-inscenace-${w}`);
    await shot(page, checkout, `25-web-checkout-${w}`);
    await page.context().close();
  }
});

