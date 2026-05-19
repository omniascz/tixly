/**
 * Golden Path UI: Promotér projde wizardem /admin/events/new a vytvoří event.
 *
 * Doplňuje API-level golden-path-promoter.spec.ts. Tady ověříme, že:
 *  - Wizard je navigovatelný (template → basics → datetime → tickets → marketing → rules → review)
 *  - Form má UI inputy pro `zone` a `isSeated` (přidáno 2026-04-29)
 *  - Submit "Publikovat" pošle správný payload na POST /api/admin/events
 *  - Backend volá copyLayoutToEventSeats a vyrobí event_seats
 *
 * Předpoklady stejné jako API spec: theatre@hranice.cz, Demo2026!, Stará střelnice.
 */
import { test, expect, type BrowserContext } from '@playwright/test';

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

test('Promotér projde wizardem /admin/events/new a vytvoří seated event', async ({
  page,
  context,
}) => {
  test.setTimeout(90_000);
  await presetCookieConsent(context);

  await test.step('Login promotér', async () => {
    await page.goto('/cs/login', { waitUntil: 'domcontentloaded' });
    // Login page potřebuje hydrate React handlery — networkidle pre-auth funguje
    // (žádné SSE/polling). Po auth se přepínáme na heading-based čekání.
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
    await page.waitForURL(/\/admin(?!\/?login)/, { timeout: 15_000 });
  });

  await test.step('Otevři wizard /admin/events/new', async () => {
    await page.goto('/admin/events/new', { waitUntil: 'domcontentloaded' });
    // Nepoužívat networkidle — admin layout má notification polling + SSE,
    // network nikdy neidlne. Stačí počkat na heading, který je client-rendered.
    await expect(page.getByRole('heading', { name: /Nová akce/i, level: 1 })).toBeVisible({
      timeout: 15_000,
    });
  });

  await test.step('Krok 1: Typ akce — Klubový koncert (single_event default)', async () => {
    // Dev server může wizard kompilovat 20+s — počkat na první template button.
    const tplBtn = page.getByRole('button', { name: /Klubový koncert/i });
    await expect(tplBtn).toBeVisible({ timeout: 30_000 });
    await tplBtn.click();
    // Po výběru template React přebuduje form (zones/ticketTypes z templatu).
    // Dáme čas na state propagaci, jinak Pokračovat click může fire před useState.
    await page.waitForTimeout(300);
    await page.getByRole('button', { name: /^Pokračovat/i }).click();
  });

  const title = `PWT UI Drama ${Date.now()}`;

  await test.step('Krok 2: basics — název', async () => {
    await expect(page.getByPlaceholder(/Letní festival/i)).toBeVisible({ timeout: 15_000 });
    await page.getByPlaceholder(/Letní festival/i).fill(title);
    await page.getByRole('button', { name: /Pokračovat/i }).click();
  });

  await test.step('Krok 3: datetime + venue Stará střelnice', async () => {
    const future = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
    // datetime-local očekává YYYY-MM-DDTHH:MM
    const dateStr = future.toISOString().slice(0, 16);
    await page.locator('input[type="datetime-local"]').first().fill(dateStr);
    // Najdi venue option, který obsahuje "Stará střelnice" v textu, a vezmi
    // jeho value. selectOption accepts string label nebo value, ne regex.
    const venueSelect = page.locator('select').last();
    // Venues se loadují async přes useEffect — počkat než option naskočí.
    await expect(venueSelect.locator('option', { hasText: /Stará střelnice/i }))
      .toHaveCount(1, { timeout: 10_000 });
    const venueOptions = await venueSelect.locator('option').allTextContents();
    const venueLabel = venueOptions.find((t) => /Stará střelnice/i.test(t));
    expect(venueLabel, 'venue Stará střelnice je v dropdown').toBeTruthy();
    await venueSelect.selectOption({ label: venueLabel! });
    await page.getByRole('button', { name: /Pokračovat/i }).click();
  });

  await test.step('Krok 4: tickets — Přízemí 232 ks, Sedadlo + zone PŘÍZEMÍ', async () => {
    // single_event template předvyplnil 2 ticket types (Standard, VIP).
    // První (Standard) přepíšeme na seated Přízemí; druhý smazneme.
    const firstName = page.getByPlaceholder(/Název.*Standard.*VIP/).first();
    await firstName.fill('Přízemí');
    await page.getByPlaceholder('Cena Kč').first().fill('350');
    await page.getByPlaceholder('Kapacita').first().fill('232');

    // Sedadlo checkbox + zone (UI inputy přidané 2026-04-29 pro P0 fix).
    // .click() spíš než .check() — radix Input je custom, ne native checked
    // attribute, ale onChange handler reaguje na click.
    const seatedCb = page.getByRole('checkbox', { name: /Sedadlo/i }).first();
    await seatedCb.click();
    await page.getByPlaceholder(/Sektor v sále/i).first().fill('PŘÍZEMÍ');
    await page.getByRole('button', { name: /Pokračovat/i }).click();
  });

  await test.step('Krok 5–7: marketing, rules — skip', async () => {
    await page.getByRole('button', { name: /Pokračovat/i }).click(); // marketing
    await page.getByRole('button', { name: /Pokračovat/i }).click(); // rules
  });

  await test.step('Review → Publikovat → POST /api/admin/events', async () => {
    const [response] = await Promise.all([
      page.waitForResponse(
        (r) => r.url().endsWith('/api/admin/events') && r.request().method() === 'POST',
        { timeout: 30_000 },
      ),
      page.getByRole('button', { name: /^Publikovat$/i }).click(),
    ]);
    const body = await response.json();
    expect(response.status(), `Create OK (got ${JSON.stringify(body)})`).toBe(201);
    expect(body.eventId).toBeTruthy();
    // P0 verification přes UI flow — payload z form správně obsahoval zone+isSeated:
    expect(body.sectorsMapped, 'PŘÍZEMÍ sektor zmapovaný na ticket type').toBeGreaterThanOrEqual(1);
    expect(body.seatsCreated, 'event_seats reálně vyrobená').toBeGreaterThanOrEqual(232);
  });
});
