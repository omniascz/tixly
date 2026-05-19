/**
 * Tour: vyfotí master admin + promoter admin dashboards a klíčové stránky.
 * Pro vizuální kontrolu UX — výstup do test-results/admin-tour/.
 */
import { test, type BrowserContext } from '@playwright/test';

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

async function login(page: import('@playwright/test').Page, email: string, password: string) {
  await page.goto('/cs/login', { waitUntil: 'domcontentloaded' });
  await page.waitForLoadState('networkidle');
  await page.getByLabel('E-mail').fill(email);
  await page.getByLabel('Heslo').fill(password);
  await Promise.all([
    page.waitForResponse(
      (r) => r.url().endsWith('/api/auth/login') && r.request().method() === 'POST',
      { timeout: 15_000 },
    ),
    page.getByRole('button', { name: /^Přihlásit$/ }).click(),
  ]);
}

test.describe.configure({ mode: 'serial' });

test('Promoter admin tour (verze@divadlovceletne.cz)', async ({ page, context }) => {
  test.setTimeout(120_000);
  await presetCookieConsent(context);
  await login(page, 'verze@divadlovceletne.cz', 'Demo2026!');
  await page.waitForURL(/\/admin(?!\/?login)/, { timeout: 15_000 });

  const screens: Array<{ url: string; name: string }> = [
    { url: '/admin', name: '01-dashboard' },
    { url: '/admin/events', name: '02-events' },
    { url: '/admin/orders', name: '03-orders' },
    { url: '/admin/customers', name: '04-customers' },
    { url: '/admin/campaigns', name: '05-campaigns' },
    { url: '/admin/notifications', name: '06-notifications' },
    { url: '/admin/webhooks', name: '07-webhooks' },
    { url: '/admin/payouts', name: '08-payouts' },
    { url: '/admin/audit-log', name: '09-audit-log' },
    { url: '/admin/settings', name: '10-settings' },
  ];

  for (const s of screens) {
    await page.goto(s.url, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(1500);
    await page.screenshot({
      path: `test-results/admin-tour/promoter-${s.name}.png`,
      fullPage: false,
    });
  }
});

test('Master admin tour (superadmin@tixly.cz)', async ({ page, context }) => {
  test.setTimeout(120_000);
  await presetCookieConsent(context);
  await login(page, 'superadmin@tixly.cz', 'Demo2026!');
  await page.waitForURL(/\/(platform|admin)(?!\/?login)/, { timeout: 15_000 });

  const screens: Array<{ url: string; name: string }> = [
    { url: '/platform', name: '01-dashboard' },
    { url: '/platform/promoters', name: '02-promoters' },
    { url: '/platform/venues', name: '03-venues' },
    { url: '/platform/event-moderation', name: '04-moderation' },
    { url: '/platform/incidents', name: '05-incidents' },
    { url: '/platform/audit-log', name: '06-audit-log' },
    { url: '/platform/analytics', name: '07-analytics' },
    { url: '/platform/webhooks', name: '08-webhooks' },
    { url: '/platform/verifications', name: '09-verifications' },
    { url: '/cs/status', name: '10-public-status' },
  ];

  for (const s of screens) {
    await page.goto(s.url, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(1500);
    await page.screenshot({
      path: `test-results/admin-tour/platform-${s.name}.png`,
      fullPage: false,
    });
  }
});
