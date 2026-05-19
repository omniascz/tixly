/**
 * Verify dev-login auto-flow: jeden klik → JWT cookie + localStorage + redirect.
 * Slouží taky jako screenshot capture pro dokumentaci.
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
    } catch {}
  });
}

test('Dev-login platform: jeden klik → /platform dashboard', async ({ page, context }) => {
  test.setTimeout(60_000);
  await presetCookieConsent(context);
  await page.goto('/cs/dev-login?as=platform', { waitUntil: 'domcontentloaded' });
  await page.waitForURL(/\/platform(?!\/?login)/, { timeout: 20_000 });
  await expect(page.getByRole('heading', { name: /Platform overview/i })).toBeVisible({
    timeout: 15_000,
  });
  await page.screenshot({
    path: 'test-results/admin-tour/dev-login-platform-result.png',
    fullPage: false,
  });
});

test('Dev-login admin: jeden klik → /admin dashboard', async ({ page, context }) => {
  test.setTimeout(60_000);
  await presetCookieConsent(context);
  await page.goto('/cs/dev-login?as=admin', { waitUntil: 'domcontentloaded' });
  await page.waitForURL(/\/admin(?!\/?login)/, { timeout: 20_000 });
  await expect(page.getByRole('heading', { name: /Přehled/i })).toBeVisible({
    timeout: 15_000,
  });
  await page.screenshot({
    path: 'test-results/admin-tour/dev-login-admin-result.png',
    fullPage: false,
  });
});
