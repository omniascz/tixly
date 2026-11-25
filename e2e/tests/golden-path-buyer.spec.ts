/**
 * Golden Path: kupec na počítači koupí 2 místa na demo termínu a prodaná / blokovaná místa už vybrat nejdou.
 *
 * Přepsáno 25. 11. 2026: dřív čekal dev server :3000 a starý seed („Romeo a Julie“), na současné demo DB padal.
 * Běží jako ostatní golden-path proti `next start` (BASE_URL, výchozí :3200) nad demo DB z migrací
 * (scripts/staging/create.sh --local + seed-demo.sql) a simulátoru GoPay :3998. Nic nejde mimo localhost.
 * Mobilní nákup s kategoriemi pokrývá scénář turné (krok 5), stránku potvrzení r20; tady desktop + nedostupná místa.
 *
 *   1. Racek, Městské divadlo Brno: 2 místa v Přízemí → kategorie → simulátor GoPay → potvrzení, objednávka paid, 2 vstupenky
 *   2. Táž místa jsou po nákupu „sold“ a bez role=button; blokovaná místa (řada 1, 7–10, blok Tisk) taky; klik nic nevybere
 */
import { expect, test, type Browser, type BrowserContext, type Page } from '@playwright/test';
import pg from 'pg';

const BASE = process.env.BASE_URL ?? 'http://localhost:3200';
const OWNER_URL = process.env.AUDIT_OWNER_URL ?? 'postgresql://neondb_owner:fixowner@localhost:55632/r23demo';
// demo termín Racek, Městské divadlo Brno (scripts/staging/seed-demo.sql) — blokace jen v řadě 1 a na balkoně
const TERM = '00000000-0000-4000-a000-000000000501';
const ROW = '4';
const SEATS = ['1', '2'];
const RUN = Date.now().toString(36);
const RUN_IP = `10.${Math.floor(Math.random() * 250)}.${Math.floor(Math.random() * 250)}.${Math.floor(Math.random() * 250) + 1}`;
const EMAIL = `buyer-${RUN}@tixly.test`;

test.describe.configure({ mode: 'serial' });
let db: pg.Client;
const q = async <T = Record<string, unknown>>(sql: string, params: unknown[] = []): Promise<T[]> =>
  (await db.query(sql, params)).rows as T[];

async function buyerContext(browser: Browser): Promise<{ ctx: BrowserContext; page: Page }> {
  const ctx = await browser.newContext({ baseURL: BASE });
  await ctx.setExtraHTTPHeaders({ 'x-real-ip': RUN_IP });
  await ctx.addInitScript(() => {
    try { window.localStorage.setItem('tixly.cookie-consent', JSON.stringify({ essential: true, analytics: false, marketing: false, decidedAt: new Date().toISOString() })); } catch { /* */ }
  });
  return { ctx, page: await ctx.newPage() };
}

/** Sedadlo v plánku; ve velkém sále je nejdřív přehled sektorů → otevřít sektor. */
async function seat(page: Page, sector: string, row: string, num: string) {
  await page.locator('svg[aria-label="Plán sálu"]').first().waitFor();
  await page.locator('svg[aria-label="Plán sálu"] [aria-label^="Sektor "]').first().waitFor({ timeout: 20_000 });
  const prefix = `Sektor ${sector}, řada ${row}, sedadlo ${num}, `;
  let c = page.locator(`[aria-label^="${prefix}"]`);
  if (!(await c.count())) {
    await page.locator(`[aria-label^="Sektor ${sector}, dostupných"]`).first().click();
    c = page.locator(`[aria-label^="${prefix}"]`);
  }
  return c.first();
}

test.beforeAll(async () => {
  db = new pg.Client({ connectionString: OWNER_URL });
  await db.connect();
});
test.afterAll(async () => { await db?.end(); });

test('1 — Racek Brno: 2 místa v Přízemí → simulátor GoPay → potvrzení, objednávka paid, 2 vstupenky', async ({ browser }) => {
  test.setTimeout(120_000);
  const { ctx, page } = await buyerContext(browser);
  await page.goto(`/cs/events/${TERM}`);
  await expect(page.getByRole('heading', { name: /Racek/ }).first()).toBeVisible();
  await page.goto(`/cs/events/${TERM}/seats`);
  for (const s of SEATS) await (await seat(page, 'Přízemí', ROW, s)).click();
  await expect(page.getByText(new RegExp(`^${SEATS.length} / \\d+ sedadel$`))).toBeVisible();
  await page.getByRole('button', { name: /Pokračovat na pokladnu/ }).click();
  await page.waitForURL(/\/seats\/kategorie/);
  await page.getByPlaceholder('E-mail').fill(EMAIL);
  await page.getByPlaceholder('Jméno a příjmení').fill('Kupec Playwright');
  await page.getByRole('button', { name: 'Zaplatit' }).click();
  await page.waitForURL(/localhost:3998\/gw\//, { timeout: 20_000 });
  await page.getByTestId('gw-pay').click();
  await page.waitForURL(/\/cs\/order-confirmation\/[0-9a-f-]{36}/, { timeout: 20_000 });
  await expect(page.getByRole('heading', { name: /Racek/ }).first()).toBeVisible();

  const orderId = page.url().match(/order-confirmation\/([0-9a-f-]{36})/)![1];
  await expect.poll(async () => (await q<{ status: string }>(`SELECT status FROM orders.orders WHERE id = $1`, [orderId]))[0]?.status,
    { timeout: 30_000 }).toBe('paid');
  await expect.poll(async () => (await q<{ seat: string }>(
    `SELECT es.seat_number AS seat FROM tickets.tickets t JOIN catalog.event_seats es ON es.id = t.event_seat_id
      WHERE t.order_id = $1 AND es.row = $2 ORDER BY es.seat_number::int`, [orderId, ROW])).map((r) => r.seat),
    { timeout: 30_000 }).toEqual(SEATS);
  await ctx.close();
});

test('2 — prodaná a blokovaná místa nejsou tlačítka a klik je nevybere', async ({ browser }) => {
  const { ctx, page } = await buyerContext(browser);
  await page.goto(`/cs/events/${TERM}/seats`);
  const sold = await seat(page, 'Přízemí', ROW, SEATS[0]);
  await expect(sold).toHaveAttribute('aria-label', /, sold/);
  await expect(sold).not.toHaveAttribute('role', 'button');
  const blocked = await seat(page, 'Přízemí', '1', '7');
  await expect(blocked).toHaveAttribute('aria-label', /, blocked/);
  await expect(blocked).not.toHaveAttribute('role', 'button');

  await sold.click({ force: true });
  await blocked.click({ force: true });
  await expect(page.getByText(/^0 \/ \d+ sedadel$/)).toBeVisible();
  await expect(page.getByRole('button', { name: /Pokračovat na pokladnu/ })).toBeDisabled();
  await ctx.close();
});
