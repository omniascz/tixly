/**
 * Golden Path: Buyer kupuje sedadla na seedované akce.
 *
 * Reálný browser flow proti dev serveru — testuje to, co API smoke testy NEpokrývaly:
 *  - SVG mapa sálu se vyrenderuje
 *  - Sedadla jdou kliknout
 *  - Hold → checkout → mock GoPay → confirmation funguje v UI
 *
 * Pokrývá:
 *  1. Romeo a Julie (Stará střelnice, 308 sedadel) — happy path
 *  2. Hamlet (stejný sál, jiný event) — multi-event integration
 *  3. Edge: sold sedadla v Romeo a Julie jsou disabled (nelze kliknout)
 *
 * Předpoklad: dev server běží na http://localhost:3000 a databáze je seedovaná.
 */
import { test, expect, type Page, type BrowserContext } from '@playwright/test';

const ROMEO_ID = '00000000-0000-4000-a000-000000000401';
const HAMLET_ID = '00000000-0000-4000-a000-000000000402';

test.describe.configure({ mode: 'serial' });

/** Před každou stránkou nastavíme cookie consent, ať banner nepřekrývá tlačítka. */
async function presetCookieConsent(context: BrowserContext): Promise<void> {
  await context.addInitScript(() => {
    try {
      window.localStorage.setItem(
        'tixly.cookie-consent',
        JSON.stringify({
          essential: true,
          analytics: false,
          marketing: false,
          decidedAt: new Date().toISOString(),
        }),
      );
    } catch {
      /* noop */
    }
  });
}

/**
 * Sdílený flow: vyber 2 dostupná sedadla v sektoru PŘÍZEMÍ a dokonči checkout.
 * Ověří listing → detail → seat picker → 2 hold → checkout → mock GoPay → confirmation.
 */
async function purchaseTwoSeatsFromPrizemi(
  page: Page,
  eventId: string,
  expectedTitle: RegExp,
): Promise<void> {
  const testEmail = `pw-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@example.cz`;

  await test.step(`Detail eventu (${expectedTitle}) se načte`, async () => {
    await page.goto(`/cs/events/${eventId}`, { waitUntil: 'domcontentloaded' });
    await expect(page.getByRole('heading', { name: expectedTitle })).toBeVisible();
  });

  await test.step('Seat picker — SVG mapa', async () => {
    await page.goto(`/cs/events/${eventId}/seats`, { waitUntil: 'domcontentloaded' });
    await page.waitForSelector('svg[aria-label="Plán sálu"]', { timeout: 30_000 });
    await page.waitForSelector('circle[role="button"]', { timeout: 10_000 });
    await expect(page.getByText(/Cenové kategorie/i)).toBeVisible();
  });

  await test.step('Vyberu 2 dostupná sedadla v PŘÍZEMÍ', async () => {
    const available = page.locator(
      'circle[role="button"][aria-label*="PŘÍZEMÍ"][aria-label*="available"]',
    );
    const count = await available.count();
    expect(count).toBeGreaterThan(2);
    await available.nth(0).click();
    await available.nth(1).click();
    await expect(page.getByText('2 / 10 sedadel')).toBeVisible();
  });

  await test.step('Hold + redirect na checkout', async () => {
    await page.getByRole('button', { name: /Pokračovat na pokladnu/i }).click();
    await page.waitForURL(/\/cs\/checkout/, { timeout: 15_000 });
  });

  await test.step('Vyplním checkout form (quantity z URL = 2, žádný workaround)', async () => {
    // Po P0c fixu (htmlFor/id) labely fungují. Po P0b fixu quantity přijde
    // z URL ?quantity=2 a netřeba ho ručně přepisovat.
    await page.getByLabel('Jméno a příjmení').fill('Test Kupec Playwright');
    await page.getByLabel('E-mail').fill(testEmail);
    await expect(page.getByLabel('Počet kusů')).toHaveValue('2');
    await page.getByRole('button', { name: /Pokračovat na platbu/i }).click();
  });

  await test.step('Mock GoPay → Zaplatit', async () => {
    await page.waitForURL(/\/mock-gopay\//, { timeout: 15_000 });
    await page.getByRole('button', { name: /^Zaplatit$/ }).click();
  });

  await test.step('Order confirmation — paid', async () => {
    await page.waitForURL(/\/cs\/order-confirmation\//, { timeout: 15_000 });
    await expect(page.getByRole('heading', { name: expectedTitle })).toBeVisible();
    expect(page.url()).toMatch(/order-confirmation\/[0-9a-f-]{36}/);
  });
}

test('Romeo a Julie: 2 sedadla z PŘÍZEMÍ → confirmation', async ({ page, context }) => {
  await presetCookieConsent(context);

  await test.step('Listing zobrazuje Romeo a Julie', async () => {
    await page.goto('/cs/events', { waitUntil: 'domcontentloaded' });
    await expect(page.getByText(/Romeo a Julie/i).first()).toBeVisible();
  });

  await purchaseTwoSeatsFromPrizemi(page, ROMEO_ID, /Romeo a Julie/i);
});

test('Hamlet (stejný sál): 2 sedadla z PŘÍZEMÍ → confirmation', async ({
  page,
  context,
}) => {
  await presetCookieConsent(context);
  await purchaseTwoSeatsFromPrizemi(page, HAMLET_ID, /Hamlet/i);
});

test('Promotér theatre@hranice.cz se přihlásí a vidí svoje akce v /admin', async ({
  page,
  context,
}) => {
  await presetCookieConsent(context);

  await test.step('Login form přijme credentials', async () => {
    await page.goto('/cs/login', { waitUntil: 'domcontentloaded' });
    // Reactu dáme čas na hydrace, jinak fill() proběhne před onChange handlery.
    await page.waitForLoadState('networkidle');
    await page.getByLabel('E-mail').fill('theatre@hranice.cz');
    await page.getByLabel('Heslo').fill('Demo2026!');
    await Promise.all([
      page.waitForResponse(
        (r) => r.url().endsWith('/api/auth/login') && r.request().method() === 'POST',
        { timeout: 15_000 },
      ),
      page.getByRole('button', { name: /^Přihlásit$/ }).click(),
    ]);
  });

  await test.step('Redirect na /admin (promotér má membership)', async () => {
    // Login zapíše localStorage + router.push('/admin'). Middleware pak
    // ověří JWT cookie a pustí na admin layout.
    await page.waitForURL(/\/admin(?!\/?login)/, { timeout: 15_000 });
  });

  await test.step('/admin/events listing má Romeo a Julie + Hamlet', async () => {
    await page.goto('/admin/events', { waitUntil: 'domcontentloaded' });
    // Hooks fetch z /api/admin/events s JWT — render je client-side, dáme čas.
    await expect(page.getByRole('link', { name: /Romeo a Julie/i })).toBeVisible({
      timeout: 15_000,
    });
    await expect(page.getByRole('link', { name: /^Hamlet$/i })).toBeVisible();
  });
});

test('Sold sedadla v Romeo a Julie jsou disabled (nelze koupit)', async ({
  page,
  context,
}) => {
  await presetCookieConsent(context);
  await page.goto(`/cs/events/${ROMEO_ID}/seats`, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('svg[aria-label="Plán sálu"]', { timeout: 30_000 });

  // Seedy ve fázi 3 označily 7 sedadel jako sold (a 2 další po předchozím testu).
  // Sold/held cirkly NEMAJÍ role="button" (interactive=false v SeatPicker.tsx
  // řádek 260+272), takže nejsou klikatelné. Ověříme, že počet je > 0.
  const soldOrHeld = page.locator(
    'circle:not([role="button"])[aria-label*="sold"], circle:not([role="button"])[aria-label*="held"]',
  );
  const soldCount = await soldOrHeld.count();
  expect(soldCount).toBeGreaterThan(0);

  // Pokus o klik na sold sedadlo: protože nemá role=button a tabIndex=-1,
  // klik nezpůsobí toggle. Sticky bar zůstane na "0 / 10 sedadel".
  await soldOrHeld.first().click({ force: true }).catch(() => {});
  await expect(page.getByText('0 / 10 sedadel')).toBeVisible();
});
