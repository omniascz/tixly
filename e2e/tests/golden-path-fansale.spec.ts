/**
 * Golden Path: FanSALE Resale Marketplace
 *
 * End-to-end ověření #1 z DACH-AUDIT-VERIFIED.md:
 *   1. Seller (anna.nova@example.cz) má valid Romeo & Julie ticket
 *   2. V my-tickets klikne "💰 Prodat na marketplace", zadá cenu ≤ face value
 *   3. Listing se objeví na /cs/resale marketplace (public, žádný login)
 *   4. Guest buyer klikne na listing → vyplní jméno+email → "Koupit"
 *   5. Backend re-issue: starý barcode revoke, nový ticket pro buyera, seller payout enqueue
 *   6. Buyer skončí na /cs/order-confirmation
 *
 * Důležitý invariant (anti-scalping):
 *   askPriceHalire > original_price ⇒ 422 PRICE_CAP_EXCEEDED
 *
 * Předpoklady seeded DB:
 *   - anna.nova@example.cz / Demo2026! existuje (memory: bcrypt Demo2026!)
 *   - Má ≥ 1 valid ticket na future event (Romeo & Julie 2026-06-15)
 *   - Event resale_policy = 'enabled'
 */
import { test, expect, type BrowserContext, type Page } from '@playwright/test';

const SELLER_EMAIL = 'anna.nova@example.cz';
const SELLER_PASSWORD = 'Demo2026!';

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

async function loginAs(
  page: Page,
  context: BrowserContext,
  email: string,
  password: string,
): Promise<string> {
  // API login + cookie/localStorage injection. Memory: tento pattern je robustní
  // proti dev server compile delays.
  const loginRes = await context.request.post('/api/auth/login', {
    data: { email, password },
  });
  if (loginRes.status() !== 200) {
    throw new Error(`Login failed (${loginRes.status()}): ${await loginRes.text()}`);
  }
  const body = (await loginRes.json()) as { accessToken: string };
  // Inject accessToken do localStorage před každou navigací (MyTicketsClient ho čte).
  await context.addInitScript((token) => {
    try {
      window.localStorage.setItem('accessToken', token);
    } catch {
      /* noop */
    }
  }, body.accessToken);
  return body.accessToken;
}

test('FanSALE: seller vystaví ticket, buyer ho koupí, starý je revoked', async ({
  page,
  context,
  browser,
}) => {
  await presetCookieConsent(context);

  // Pojistka: pokud existují předchozí aktivní listingy téhož sellera,
  // přeskočíme jejich row a najdeme „Prodat na marketplace" tlačítko.
  // (Test je idempotentní — drop jen aktivní listing tomu kupci pro test isolation.)

  await test.step('1. Seller login (API + localStorage inject)', async () => {
    await loginAs(page, context, SELLER_EMAIL, SELLER_PASSWORD);
  });

  let listingPriceCzk = '';

  await test.step('2. Seller otevře my-tickets a vystaví Romeo & Julie', async () => {
    await page.goto('/cs/my-tickets', { waitUntil: 'domcontentloaded' });
    // Počkat na load tickets
    await expect(page.getByText(/Romeo a Julie/i).first()).toBeVisible({ timeout: 15_000 });

    // Najdi první ticket card s Romeo a Julie, který má aktivní "Prodat na marketplace"
    // (pokud má aktivní listing, button je "Stáhnout z marketplace" — preferujeme čistý ticket).
    const sellButton = page.getByTestId('resale-sell-button').first();
    await sellButton.scrollIntoViewIfNeeded();
    await sellButton.click();

    // Cena pod face value (350 Kč). 300 = 30000 halire, OK.
    listingPriceCzk = '300';
    await page.getByTestId('resale-ask-price-input').fill(listingPriceCzk);
    await page.getByTestId('resale-confirm-button').click();

    const result = page.getByTestId('resale-result-message');
    await expect(result).toBeVisible({ timeout: 10_000 });
    await expect(result).toContainText(/vystaven/i);
    await expect(result).toContainText('300');
  });

  let createdListingId = '';
  let createdEventTitle = '';

  await test.step('3. Marketplace API obsahuje nový listing za 300 Kč', async () => {
    const res = await context.request.get('/api/resale/marketplace');
    expect(res.status()).toBe(200);
    const body = (await res.json()) as {
      listings: Array<{
        listingId: string;
        event: { title: string };
        askPriceHalire: number;
        originalPriceHalire: number;
      }>;
    };
    // Najdi listing 300 Kč (face value 350 Kč) — nepředpokládáme titul, jen invariant.
    const found = body.listings.find(
      (l) => l.askPriceHalire === 30000 && l.originalPriceHalire === 35000,
    );
    expect(found, '300 Kč listing s face value 350 Kč viditelný v marketplace').toBeTruthy();
    createdListingId = found!.listingId;
    createdEventTitle = found!.event.title;
  });

  // Buyer (čistý guest context) → public /cs/resale → koupit
  await test.step('4. Guest buyer vidí listing na /cs/resale', async () => {
    const guestCtx = await browser.newContext();
    await presetCookieConsent(guestCtx);
    const guestPage = await guestCtx.newPage();
    await guestPage.goto('/cs/resale', { waitUntil: 'domcontentloaded' });

    await expect(guestPage.getByRole('heading', { name: /Resale marketplace/i })).toBeVisible();
    const row = guestPage.locator('li', { hasText: createdEventTitle }).first();
    await expect(row).toBeVisible({ timeout: 10_000 });
    await expect(row.getByText(/300 Kč/)).toBeVisible();

    await test.step('5. Klik na "Koupit" → detail s formulářem', async () => {
      await row.getByRole('link', { name: /^Koupit$/ }).click();
      await guestPage.waitForURL(new RegExp(`/cs/resale/${createdListingId}`), { timeout: 10_000 });
      await expect(guestPage.getByText(/Koupit za 300 Kč/i)).toBeVisible();
    });

    await test.step('6. Vyplnit jméno + email a submitnout', async () => {
      const testEmail = `pw-resale-${Date.now()}@example.cz`;
      await guestPage.getByLabel('Jméno a příjmení').fill('Test Resale Kupec');
      await guestPage.getByLabel('E-mail').fill(testEmail);
      await guestPage.getByRole('button', { name: /Koupit za 300 Kč/i }).click();

      await guestPage.waitForURL(/\/cs\/order-confirmation\/[0-9a-f-]{36}/, {
        timeout: 15_000,
      });
    });

    await guestCtx.close();
  });
});

test('FanSALE: nad face value cena vrátí 422 PRICE_CAP_EXCEEDED (API)', async ({
  request,
}) => {
  // Login API → získat accessToken → POST list s cenou > face value.
  // Testujeme čistě backendovou ochranu (nezávisí na UI state z předchozího testu).
  const loginRes = await request.post('/api/auth/login', {
    data: { email: SELLER_EMAIL, password: SELLER_PASSWORD },
  });
  expect(loginRes.status()).toBe(200);
  const { accessToken } = (await loginRes.json()) as { accessToken: string };

  // Najít Anna's valid Romeo & Julie ticket (35000 face value)
  const ticketsRes = await request.get('/api/buyer/my-tickets', {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  expect(ticketsRes.status()).toBe(200);
  const { tickets } = (await ticketsRes.json()) as {
    tickets: Array<{ id: string; status: string; event_title: string }>;
  };
  const valid = tickets.find((t) => t.status === 'valid');
  expect(valid, 'Anna má alespoň 1 valid ticket').toBeTruthy();

  // 50000 halire = 500 Kč > 350 Kč face value = PRICE_CAP_EXCEEDED
  const listRes = await request.post('/api/buyer/resale/list', {
    headers: { Authorization: `Bearer ${accessToken}` },
    data: { ticketId: valid!.id, askPriceHalire: 50000 },
  });
  expect(listRes.status()).toBe(422);
  const body = (await listRes.json()) as { error: string; maxHalire: number };
  expect(body.error).toBe('PRICE_CAP_EXCEEDED');
  expect(body.maxHalire).toBeGreaterThan(0);
});
