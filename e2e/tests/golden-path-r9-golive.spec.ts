/**
 * Kolo 9 / krok 1 — Playwright:
 *  A) administrace promo kódu: omezení na termín, slevové kategorie a cenové zóny nastavitelné v UI (dřív jen API);
 *  B) obrázky po zmírnění Next advisory (images.unoptimized): veřejná stránka (kiosk, next/image) i administrace
 *     (fotky pohledu ze sedadla) obrázky zobrazí, /_next/image optimalizace se nepoužívá.
 * Proti lokálnímu `next start` (BASE_URL, výchozí :3200) a lokální DB (AUDIT_OWNER_URL). Screenshoty logs/r9/golive/.
 */
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import pg from 'pg';

const BASE = process.env.BASE_URL ?? 'http://localhost:3200';
const OWNER_URL = process.env.AUDIT_OWNER_URL ?? 'postgresql://neondb_owner:fixowner@localhost:55632/r8z';
const SHOTS = join(__dirname, '..', '..', 'logs', 'r9', 'golive');
const RUN = Date.now().toString(36);
const PASS = 'Golive2026!heslo';
const IP = `10.9.${Math.floor(Math.random() * 250)}.${Math.floor(Math.random() * 250) + 1}`;
mkdirSync(SHOTS, { recursive: true });
test.describe.configure({ mode: 'serial' });

let db: pg.Client;
const S = { email: `golive-${RUN}@agentura.test`, promoterId: '', slug: `golive-${RUN}`, eventId: '', zoneA: '', zoneB: '', seatId: '' };
const q = async <T = Record<string, unknown>>(sql: string, p: unknown[] = []) => (await db.query(sql, p)).rows as T[];

async function login(page: Page): Promise<void> {
  await page.context().setExtraHTTPHeaders({ 'x-real-ip': IP });
  await page.context().addInitScript(() => {
    try { localStorage.setItem('tixly.cookie-consent', JSON.stringify({ essential: true, analytics: false, marketing: false, decidedAt: new Date().toISOString() })); } catch { /* */ }
  });
  await page.goto('/cs/login', { waitUntil: 'domcontentloaded' });
  await page.waitForLoadState('networkidle');
  await page.getByLabel('E-mail').fill(S.email);
  await page.getByLabel('Heslo').fill(PASS);
  await Promise.all([
    page.waitForResponse((r) => r.url().endsWith('/api/auth/login') && r.request().method() === 'POST'),
    page.getByRole('button', { name: /^Přihlásit$/ }).click(),
  ]);
  await page.waitForURL(/\/admin(?!\/?login)/, { timeout: 20_000 });
}

test.beforeAll(async ({ playwright }) => {
  db = new pg.Client({ connectionString: OWNER_URL });
  await db.connect();
  const api = await playwright.request.newContext({ baseURL: BASE, extraHTTPHeaders: { 'x-real-ip': IP, origin: BASE } });
  const r = await api.post('/api/auth/register', { data: { email: S.email, password: PASS, name: 'Golive Agentura' } });
  expect(r.status(), await r.text()).toBe(200);
  await api.dispose();
  S.promoterId = (await q<{ id: string }>(
    `INSERT INTO platform.promoters (name, email, contact_email, slug, status, vat_payer, company_dic)
     VALUES ('Golive agentura', $1, $1, $2, 'active', true, 'CZ12345678') RETURNING id`, [S.email, S.slug]))[0].id;
  await db.query(`INSERT INTO platform.promoter_members (promoter_id, user_id, role) SELECT $1, id, 'owner' FROM identity.users WHERE email = $2`, [S.promoterId, S.email]);
  // logo pořadatele a obálka termínu = statický obrázek téhož původu (CSP img-src povoluje 'self' a https:)
  await db.query(`INSERT INTO platform.promoter_branding (promoter_id, logo_url) VALUES ($1, '/icon-192.png')`, [S.promoterId]);
  const venue = (await q<{ id: string }>(`INSERT INTO catalog.venues (name, city, country, capacity) VALUES ('Městské divadlo – Velký sál', 'Brno', 'CZ', 100) RETURNING id`))[0].id;
  S.eventId = (await q<{ id: string }>(
    `INSERT INTO catalog.events (organizer_id, promoter_id, venue_id, title, slug, status, currency, event_type, date_start, cover_image_url)
     VALUES ($1, $1, $2, 'Racek', $3, 'published', 'CZK', 'theatre', now() + interval '20 days', '/icon-512.png') RETURNING id`,
    [S.promoterId, venue, `racek-${RUN}`]))[0].id;
  const tt = async (name: string, price: number) => (await q<{ id: string }>(
    `INSERT INTO catalog.ticket_types (event_id, name, kind, base_price, total_qty, remaining_qty, visibility, vat_rate_code, zone, is_seated)
     VALUES ($1, $2, 'standing', $3, 10, 10, 'public', 'CZ_REDUCED', $2, true) RETURNING id`, [S.eventId, name, price]))[0].id;
  S.zoneA = await tt('Zóna A', 45000);
  S.zoneB = await tt('Zóna B', 30000);
  S.seatId = (await q<{ id: string }>(
    `INSERT INTO catalog.event_seats (event_id, ticket_type_id, sector, row, seat_number, x_coord, y_coord, status)
     VALUES ($1, $2, 'Přízemí', '1', '1', 20, 20, 'available') RETURNING id`, [S.eventId, S.zoneA]))[0].id;
  await db.query(`INSERT INTO catalog.event_seat_view_photos (event_seat_id, photo_url, thumbnail_url) VALUES ($1, '/icon-512.png', '/icon-192.png')`, [S.seatId]);
  for (const [code, name, kind, sort] of [['plne', 'Plné', 'full', 0], ['senior', 'Senior', 'senior', 10], ['student', 'Student', 'student', 20]] as const) {
    await db.query(
      `INSERT INTO catalog.price_categories (promoter_id, event_id, code, name, kind, price_mode, price_value, sort_order)
       VALUES ($1, $2, $3, $4, $5, 'percent', 10000, $6)`, [S.promoterId, S.eventId, code, name, kind, sort]);
  }
});
test.afterAll(async () => { await db?.end(); });

test('A — promo kód: omezení na termín, kategorie a zóny v administraci', async ({ page }) => {
  await login(page);
  await page.goto('/admin/promo-codes');
  const code = `PLNEA${RUN.toUpperCase()}`.slice(0, 20);
  await page.getByPlaceholder('LETO2026').fill(code);
  await page.getByLabel('Termín pro omezení').selectOption(S.eventId);
  const box = page.getByTestId('promo-restrictions');
  await box.getByLabel('Plné').check();
  await box.getByLabel('Zóna A').check();
  await page.screenshot({ path: join(SHOTS, 'a1-promo-formular.png'), fullPage: true });
  await page.getByRole('button', { name: 'Vytvořit kód' }).click();
  await expect(page.locator('tr', { hasText: code }).getByTestId('promo-restriction')).toContainText('kategorie: plne');
  await expect(page.locator('tr', { hasText: code }).getByTestId('promo-restriction')).toContainText('zóny: Zóna A');
  await expect(page.locator('tr', { hasText: code }).getByTestId('promo-restriction')).toContainText('termín: Racek');
  await page.screenshot({ path: join(SHOTS, 'a2-promo-seznam.png'), fullPage: true });
  const row = (await q<{ cats: string[]; tts: string[]; evs: string[] }>(
    `SELECT applicable_category_codes AS cats, applicable_ticket_type_ids::text[] AS tts, applicable_event_ids::text[] AS evs FROM marketing.promo_codes WHERE code = $1`, [code]))[0];
  expect(row).toEqual({ cats: ['plne'], tts: [S.zoneA], evs: [S.eventId] });

  // bez omezení zůstává bez omezení
  const free = `VOLNY${RUN.toUpperCase()}`.slice(0, 20);
  await page.getByPlaceholder('LETO2026').fill(free);
  await page.getByRole('button', { name: 'Vytvořit kód' }).click();
  await expect(page.locator('tr', { hasText: free }).getByTestId('promo-restriction')).toHaveText('bez omezení');
});

test('B — obrázky po vypnutí optimalizace: veřejný web (next/image) i administrace', async ({ page, request }) => {
  // veřejný kiosk pořadatele: logo + obálka termínu přes next/image
  const res = await page.goto(`/kiosk/${S.slug}`);
  expect(res?.status()).toBe(200);
  const imgs = page.locator('img');
  await expect(imgs.first()).toBeVisible();
  const info = await imgs.evaluateAll((els) => els.map((e) => ({ src: e.getAttribute('src') ?? '', w: (e as HTMLImageElement).naturalWidth })));
  expect(info.length).toBeGreaterThanOrEqual(2);
  for (const i of info) {
    expect(i.src, 'obrázek nesmí jít přes /_next/image').not.toContain('/_next/image');
    expect(i.w, `obrázek ${i.src} se nenačetl`).toBeGreaterThan(0);
  }
  // název pořadatele a termínu musí být čitelný na tmavém pozadí (dřív tmavý text na tmavém)
  for (const h of [page.getByRole('heading', { name: 'Golive agentura' }), page.getByRole('heading', { name: 'Racek' })]) {
    await expect(h).toBeVisible();
    expect(await h.evaluate((e) => getComputedStyle(e).color)).toBe('rgb(255, 255, 255)');
  }
  await page.screenshot({ path: join(SHOTS, 'b1-kiosk-obrazky.png'), fullPage: true });
  // optimalizační endpoint se nepoužívá (AVIF/DoS advisory)
  const opt = await request.get('/_next/image?url=%2Ficon-512.png&w=640&q=75');
  expect(opt.status(), 'optimalizace obrázků musí být vypnutá').not.toBe(200);

  // administrace: fotky pohledu ze sedadla
  await login(page);
  await page.goto(`/admin/events/${S.eventId}/view-photos`);
  const thumb = page.locator('img[alt^="Pohled ze sedadla"]').first();
  await expect(thumb).toBeVisible();
  expect(await thumb.evaluate((e) => (e as HTMLImageElement).naturalWidth)).toBeGreaterThan(0);
  await page.screenshot({ path: join(SHOTS, 'b2-admin-fotky-pohledu.png'), fullPage: true });
});
