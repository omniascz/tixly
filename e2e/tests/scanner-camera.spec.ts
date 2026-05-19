/**
 * Camera scanner UI smoke test.
 *
 * Ověřuje že:
 * - Tlačítko "kamera" je viditelné v scanner page
 * - Klik otevře modal s `dialog` role + aria-label
 * - ESC + close button zavírají modal
 *
 * Skutečnou kameru NEvolá (headless Playwright nemá), jen UI vrstvu.
 */
import { test, expect } from '@playwright/test';

test.describe('Scanner camera button', () => {
  test.beforeEach(async ({ page }) => {
    // Dev quick-login jako platform admin (bez credentials, session work)
    await page.goto('/cs/dev-login?as=admin');
    await page.waitForURL(/\/admin/, { timeout: 15_000 });
  });

  test('tlačítko kamery otevírá modal s aria-modal', async ({ page }) => {
    await page.goto('/admin/scanner');
    await page.waitForSelector('[data-testid="scanner-ticket-input"]');

    const cameraBtn = page.locator('[data-testid="scanner-open-camera"]');
    await expect(cameraBtn).toBeVisible();

    await cameraBtn.click();
    const modal = page.getByRole('dialog', { name: /QR kamera scanner/i });
    await expect(modal).toBeVisible();
  });

  test('ESC zavře modal', async ({ page }) => {
    await page.goto('/admin/scanner');
    await page.waitForSelector('[data-testid="scanner-open-camera"]');
    await page.click('[data-testid="scanner-open-camera"]');
    await expect(page.getByRole('dialog', { name: /QR kamera/i })).toBeVisible();

    await page.keyboard.press('Escape');
    await expect(page.getByRole('dialog', { name: /QR kamera/i })).toBeHidden();
  });

  test('close button zavře modal', async ({ page }) => {
    await page.goto('/admin/scanner');
    await page.waitForSelector('[data-testid="scanner-open-camera"]');
    await page.click('[data-testid="scanner-open-camera"]');
    const modal = page.getByRole('dialog', { name: /QR kamera/i });
    await expect(modal).toBeVisible();

    await modal.getByRole('button', { name: /zavřít/i }).first().click();
    await expect(modal).toBeHidden();
  });
});
