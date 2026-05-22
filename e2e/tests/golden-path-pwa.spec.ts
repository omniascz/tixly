/**
 * Golden Path: PWA (DACH P2-5, Tixly diferenciátor)
 *
 * Tixly je buyer-installable PWA. ADticket, München Ticket, Reservix
 * nemají buyer mobile app — Tixly diferenciátor v CZ/SK trhu.
 *
 * Pokrytí:
 *   1) manifest.json validní, povinné fieldy podle W3C
 *   2) /sw.js dostupný, GET 200, JS content-type
 *   3) sw.js obsahuje push handler + offline fallback
 *   4) /offline page GET 200
 *   5) Apple meta tagy v HTML head pro iOS install
 *   6) ServiceWorker registration script existuje v page (client-side)
 */
import { test, expect } from '@playwright/test';

test('PWA manifest: validní, povinné fieldy + shortcuts', async ({ context }) => {
  const r = await context.request.get('/manifest.json');
  expect(r.status()).toBe(200);
  const m = (await r.json()) as {
    name: string;
    short_name: string;
    start_url: string;
    display: string;
    theme_color: string;
    background_color: string;
    icons: Array<{ src: string; sizes: string; type: string; purpose?: string }>;
    shortcuts?: Array<{ name: string; url: string }>;
  };
  expect(m.name).toBe('Tixly');
  expect(m.short_name).toBeTruthy();
  expect(m.start_url).toBe('/cs/my-tickets');
  expect(m.display).toBe('standalone');
  expect(m.theme_color).toMatch(/^#[0-9A-Fa-f]{6}$/);
  expect(m.icons.length).toBeGreaterThanOrEqual(2);
  // Maskable icon pro Android adaptive icons
  expect(m.icons.some((i) => i.purpose?.includes('maskable'))).toBe(true);
  // 192 a 512 sizes
  expect(m.icons.some((i) => i.sizes === '192x192')).toBe(true);
  expect(m.icons.some((i) => i.sizes === '512x512')).toBe(true);
  // Shortcuts pro Android long-press
  expect(m.shortcuts?.length).toBeGreaterThanOrEqual(2);
});

test('PWA service worker: /sw.js dostupný + obsahuje cache + push handlers', async ({
  context,
}) => {
  const r = await context.request.get('/sw.js');
  expect(r.status()).toBe(200);
  const content = await r.text();
  // Cache version bumped na v2 (offline fallback)
  expect(content).toContain('tixly-v');
  // Push notification handler
  expect(content).toContain("addEventListener('push'");
  expect(content).toContain('showNotification');
  // Notification click navigation
  expect(content).toContain("addEventListener('notificationclick'");
  // Offline navigation fallback
  expect(content).toContain('/offline');
  // Stale-while-revalidate strategy pro my-tickets
  expect(content).toMatch(/staleWhileRevalidate|stale-while-revalidate/);
});

test('PWA icons: /icon-192.png a /icon-512.png dostupné', async ({ context }) => {
  const i192 = await context.request.get('/icon-192.png');
  expect(i192.status()).toBe(200);
  expect(i192.headers()['content-type']).toMatch(/png/i);

  const i512 = await context.request.get('/icon-512.png');
  expect(i512.status()).toBe(200);
});

test('PWA offline page: /offline GET 200', async ({ page }) => {
  await page.goto('/offline');
  await page.waitForLoadState('domcontentloaded');
  await expect(page.getByText('Jsi offline')).toBeVisible();
  await expect(page.getByText(/Moje vstupenky/)).toBeVisible();
});

test('PWA head: meta tagy + manifest link', async ({ page }) => {
  await page.goto('/cs/events');
  await page.waitForLoadState('domcontentloaded');

  // <link rel="manifest" href="/manifest.json">
  const manifestLink = await page.locator('link[rel="manifest"]').count();
  expect(manifestLink).toBeGreaterThan(0);

  // Apple iOS install support
  const appleCapable = await page
    .locator('meta[name="apple-mobile-web-app-capable"]')
    .getAttribute('content');
  expect(appleCapable).toBe('yes');

  // theme-color meta
  const themeColor = await page
    .locator('meta[name="theme-color"]')
    .first()
    .getAttribute('content');
  expect(themeColor).toMatch(/^#[0-9A-Fa-f]{6}$/);

  // apple touch icon
  const appleIcon = await page.locator('link[rel="apple-touch-icon"]').count();
  expect(appleIcon).toBeGreaterThan(0);
});

async function fireBeforeInstall(
  page: import('@playwright/test').Page,
  outcome: 'accepted' | 'dismissed' = 'accepted',
): Promise<void> {
  await page.evaluate((expectedOutcome) => {
    const ev = new Event('beforeinstallprompt') as Event & {
      prompt: () => Promise<void>;
      userChoice: Promise<{ outcome: string }>;
    };
    ev.prompt = () => Promise.resolve();
    ev.userChoice = Promise.resolve({ outcome: expectedOutcome });
    window.dispatchEvent(ev);
  }, outcome);
}

test('PWA install prompt: Android beforeinstallprompt → Nainstalovat button', async ({
  page,
}) => {
  await page.goto('/cs/events');
  await page.waitForLoadState('networkidle');
  // Wait pro React mount + useEffect addEventListener
  await page.waitForFunction(() => {
    const c = document.querySelector('body');
    return c && c.children.length > 0;
  });

  await fireBeforeInstall(page, 'accepted');

  await expect(page.getByTestId('install-prompt-android')).toBeVisible({
    timeout: 5000,
  });
  await expect(page.getByTestId('install-prompt-accept')).toBeVisible();
});

test('PWA install prompt: dismiss zachová v localStorage', async ({ context, page }) => {
  // Wipe storage před prvním goto (clearCookies + page.context.clearPermissions)
  await context.clearCookies();
  await page.addInitScript(() => {
    try {
      window.localStorage.removeItem('tixly.install-dismissed-at');
    } catch {
      /* */
    }
  });

  await page.goto('/cs/events');
  await page.waitForLoadState('networkidle');

  await fireBeforeInstall(page, 'dismissed');

  await expect(page.getByTestId('install-prompt-android')).toBeVisible({ timeout: 5000 });

  await page.getByText('Ne teď').click();

  await expect(page.getByTestId('install-prompt-android')).not.toBeVisible();

  const ts = await page.evaluate(() => localStorage.getItem('tixly.install-dismissed-at'));
  expect(ts).toBeTruthy();
  expect(Number(ts)).toBeGreaterThan(Date.now() - 60_000);
});
