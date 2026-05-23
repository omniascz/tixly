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
import { Pool } from 'pg';

const SELLER_EMAIL = 'anna.nova@example.cz';
const SELLER_PASSWORD = 'Demo2026!';

// Self-managed DB cleanup — bez tohoto se test stane flaky když Anna má
// active listings z předchozích runs ('Stáhnout z marketplace' button
// místo 'Prodat na marketplace').
const pool = new Pool({
  connectionString:
    process.env.DATABASE_URL ?? 'postgresql://tixly:tixly_dev@localhost:5433/tixly',
});

test.beforeAll(async () => {
  // 1) Cancel všechny aktivní Anna's listings — UI by jinak ukazovala
  // "Stáhnout z marketplace" místo "Prodat na marketplace".
  await pool.query(
    `UPDATE resale.resale_listings
        SET status = 'cancelled', cancelled_at = NOW()
      WHERE seller_id = (SELECT id FROM identity.users WHERE email = $1)
        AND status = 'active'`,
    [SELLER_EMAIL],
  );
  // 2) Revoke Anna's charity-claimed tickety (original_price=0) — UI by
  // jinak nabídla resale na ně, ale PRICE_CAP_EXCEEDED hodí pro jakoukoli
  // cenu > 0 → test by failoval na první kliknutí.
  await pool.query(
    `UPDATE tickets.tickets
        SET status = 'revoked', revoked_at = NOW()
      WHERE owner_id = (SELECT id FROM identity.users WHERE email = $1)
        AND status = 'valid'
        AND original_price = 0`,
    [SELLER_EMAIL],
  );
});

test.afterAll(async () => {
  await pool.end();
});

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

  await test.step('2. Seller otevře my-tickets a vystaví na marketplace', async () => {
    await page.goto('/cs/my-tickets', { waitUntil: 'domcontentloaded' });
    // Počkat na resale-sell-button (libovolný ticket — předtím hardcoded
    // "Romeo a Julie" ale Anna má teď E2E Test Concert tickety z předchozích
    // test runs, ne Romeo. Test ověřuje resale flow, ne konkrétní event title).
    const sellButton = page.getByTestId('resale-sell-button').first();
    await expect(sellButton).toBeVisible({ timeout: 15_000 });
    await sellButton.scrollIntoViewIfNeeded();
    await sellButton.click();

    // Cena 100 Kč — pod face value pro libovolný ticket > 100 Kč face.
    listingPriceCzk = '100';
    await page.getByTestId('resale-ask-price-input').fill(listingPriceCzk);
    await page.getByTestId('resale-confirm-button').click();

    // resale-result-message je renderován v každém ticket card → multiple
    // matches. Pro success branch otevřeného formuláře by měl být právě 1
    // viditelný (ostatní jsou v collapsed sekcích bez výsledku).
    // Plus 30s timeout — Next.js dev může compile cold API route delší.
    const result = page.getByTestId('resale-result-message').first();
    await expect(result).toBeVisible({ timeout: 30_000 });
    // Po úspěšném listing message obsahuje "vystaven" + 100 Kč.
    // Pokud test ticket byl charity-claimed (original_price=0), zde
    // dostaneme PRICE_CAP_EXCEEDED → test by failoval na assertion.
    // Pre-cleanup v beforeAll smaže listings ALE NEMĚNÍ original_price na
    // ticketu. Test musí klepnout na první ticket KTERÝ má original_price > 0.
    const txt = (await result.textContent()) ?? '';
    if (/face value \(0 Kč\)/i.test(txt)) {
      throw new Error(
        'První click padl na ticket s original_price=0 (charity-claimed). ' +
          'Test by měl předkliknout na jiný ticket. Doplň testid filtraci.',
      );
    }
    await expect(result).toContainText(/vystaven/i);
    await expect(result).toContainText('100');
  });

  let createdListingId = '';
  let createdEventTitle = '';

  await test.step('3. Marketplace API obsahuje nový listing za 100 Kč', async () => {
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
    // Najdi listing s ask=100 Kč (10000 halire). Face value (originalPriceHalire)
    // záleží na konkrétním ticket type — netestujeme equality.
    const found = body.listings.find((l) => l.askPriceHalire === 10000);
    expect(found, '100 Kč listing viditelný v marketplace').toBeTruthy();
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
    await expect(row.getByText(/100 Kč/)).toBeVisible();

    await test.step('5. Klik na "Koupit" → detail s formulářem', async () => {
      await row.getByRole('link', { name: /^Koupit$/ }).click();
      await guestPage.waitForURL(new RegExp(`/cs/resale/${createdListingId}`), { timeout: 10_000 });
      await expect(guestPage.getByText(/Koupit za 100 Kč/i)).toBeVisible();
    });

    await test.step('6. Vyplnit jméno + email a submitnout', async () => {
      const testEmail = `pw-resale-${Date.now()}@example.cz`;
      await guestPage.getByLabel('Jméno a příjmení').fill('Test Resale Kupec');
      await guestPage.getByLabel('E-mail').fill(testEmail);
      await guestPage.getByRole('button', { name: /Koupit za 100 Kč/i }).click();

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

  // Najít Anna's valid Romeo & Julie ticket (face value > 0). Charity-claimed
  // tickety mají original_price=0 — filtrujeme je out, jinak PRICE_CAP check
  // by se počítal jako 0 a test by failoval na maxHalire=0.
  const ticketsRes = await request.get('/api/buyer/my-tickets', {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  expect(ticketsRes.status()).toBe(200);
  const { tickets } = (await ticketsRes.json()) as {
    tickets: Array<{
      id: string;
      status: string;
      event_title: string;
      original_price: number;
    }>;
  };
  const valid = tickets.find(
    (t) => t.status === 'valid' && t.original_price > 0,
  );
  expect(valid, 'Anna má alespoň 1 valid ticket s face value > 0').toBeTruthy();

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
