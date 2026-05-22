/**
 * Golden Path: Public pricing page
 *
 * Tixly cross-comparison matrix gap (Eventim Light + Ticketino jediní v DACH).
 * Veřejná stránka /cs/pricing (+ sk + en lokalizace) s 3 tiers (Starter, Pro,
 * Enterprise), fair refund note, srovnání s konkurencí, FAQ.
 */
import { test, expect } from '@playwright/test';

test('Pricing CZ: 3 tiers + CTA + FAQ', async ({ page }) => {
  await page.goto('/cs/pricing');
  await page.waitForLoadState('domcontentloaded');

  await expect(page.getByRole('heading', { name: /Transparentní ceník/i, level: 1 })).toBeVisible();
  await expect(page.getByTestId('tier-starter')).toBeVisible();
  await expect(page.getByTestId('tier-pro')).toBeVisible();
  await expect(page.getByTestId('tier-enterprise')).toBeVisible();

  // Pro tier má "Nejoblíbenější" badge
  await expect(
    page.getByTestId('tier-pro').getByText('Nejoblíbenější'),
  ).toBeVisible();

  // Fee zobrazené pro každý tier
  await expect(page.getByTestId('tier-starter').getByText('5 %')).toBeVisible();
  await expect(page.getByTestId('tier-pro').getByText('7 %')).toBeVisible();
  await expect(page.getByTestId('tier-enterprise').getByText(/Na vyžádání/)).toBeVisible();

  // CTA links
  await expect(
    page.getByTestId('tier-starter').getByRole('link', { name: /Začít zdarma/ }),
  ).toBeVisible();
  await expect(
    page.getByTestId('tier-enterprise').getByRole('link', { name: /Kontaktovat sales/ }),
  ).toBeVisible();

  // Fair refund + competitor comparison section
  await expect(page.getByText(/Fair refund/i)).toBeVisible();
  await expect(page.getByText(/Eventim Light/)).toBeVisible();

  // FAQ
  await expect(page.getByText(/Často kladené otázky/)).toBeVisible();
});

test('Pricing SK: lokalizovaný obsah', async ({ page }) => {
  await page.goto('/sk/pricing');
  await page.waitForLoadState('domcontentloaded');

  await expect(page.getByRole('heading', { name: /Transparentný cenník/i })).toBeVisible();
  await expect(page.getByTestId('tier-pro').getByText('Najobľúbenejšie')).toBeVisible();
  await expect(page.getByText(/Vyskúšať Pro 30 dní/)).toBeVisible();
});

test('Pricing EN: anglický obsah', async ({ page }) => {
  await page.goto('/en/pricing');
  await page.waitForLoadState('domcontentloaded');

  await expect(page.getByRole('heading', { name: /Transparent pricing/i })).toBeVisible();
  await expect(page.getByTestId('tier-pro').getByText('Most popular')).toBeVisible();
  await expect(page.getByText(/Try Pro 30 days/)).toBeVisible();
});

test('Pricing: TopNav link visible pro anonymního uživatele', async ({ page, context }) => {
  await context.clearCookies();
  await page.goto('/cs/events', { waitUntil: 'domcontentloaded' });
  await expect(page.getByRole('link', { name: /^Ceník$/ })).toBeVisible({
    timeout: 10_000,
  });
});
