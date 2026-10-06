/**
 * Kolo 13 / krok 4 — screenshoty hlavních obrazovek pro srovnání d0bbcb00 (před kolem 12) a výsledku kola 13.
 * Jen čte (žádné zápisy), běží proti stejné DB; výstup do SHOTS (logs/r13/screens/<d0bbcb00|r13>).
 */
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { test, type Browser, type Page } from '@playwright/test';

const BASE = process.env.BASE_URL ?? 'http://localhost:3200';
const SHOTS = process.env.SHOTS ?? '../logs/r13/screens/r13';
const OWNER = { email: 'demo@tixly-staging.test', pass: 'Demo2026!heslo' };
const RBRNO = process.env.RBRNO ?? '00000000-0000-4000-a000-000000000501';
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
  await page.waitForTimeout(800);
  await page.screenshot({ path: join(SHOTS, `${name}.png`), fullPage: true });
}

const ADMIN: Array<[string, string, ((p: Page) => Promise<void>)?]> = [
  ['/admin', '01-admin-menu'],
  ['/admin/events', '02-akce-seznam'],
  ['/admin/productions/00000000-0000-4000-a000-000000000401', '03-inscenace-terminy'],
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

test('web akce — desktop a mobil', async ({ browser }) => {
  test.setTimeout(180_000);
  for (const mobile of [false, true]) {
    const page = await open(browser, mobile, false);
    const w = mobile ? 390 : 1440;
    await shot(page, '/cs', `20-web-uvod-${w}`);
    await shot(page, `/cs/events/${RBRNO}`, `21-web-akce-${w}`);
    await shot(page, `/cs/events/${RBRNO}/seats`, `22-web-mista-${w}`, async (p) => { await p.locator('svg circle, button[aria-label*="řada"], [data-seat]').first().waitFor({ timeout: 8000 }).catch(() => {}); });
    await page.context().close();
  }
});
