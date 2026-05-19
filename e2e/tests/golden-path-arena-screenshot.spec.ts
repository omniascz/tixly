/**
 * Vyfotí nové layouty Arena Praha + Olomouc + Stadion Praha
 * pro vizuální verify after seating rewrite.
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

const EVENTS = [
  { id: '00000000-0000-4000-a000-000000000404', name: 'arena-praha-mainstream', label: 'Arena Praha' },
  { id: '00000000-0000-4000-a000-000000000410', name: 'olomouc-fc', label: 'Olomouc' },
];

for (const ev of EVENTS) {
  test(`Seating screenshot — ${ev.label}`, async ({ page, context }) => {
    test.setTimeout(60_000);
    await presetCookieConsent(context);
    await page.goto(`/cs/events/${ev.id}/seats`, { waitUntil: 'domcontentloaded' });
    await page.waitForSelector('svg[aria-label="Plán sálu"]', { timeout: 30_000 });
    await page.waitForTimeout(2_000); // počkat na full render
    await page.screenshot({
      path: `test-results/admin-tour/seating-${ev.name}.png`,
      fullPage: false,
    });
  });
}
