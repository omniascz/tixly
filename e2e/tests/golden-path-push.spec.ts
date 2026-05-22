/**
 * Golden Path: Push notifications opt-in (DACH P2-5 PWA polish)
 *
 * Tixly už mělo backend (web-push lib + POST/DELETE /api/buyer/push/subscribe
 * + service worker push handlers). Co chybělo: VAPID public key endpoint +
 * PushOptInPrompt klient komponenta.
 *
 * Pokrytí:
 *   1) /api/public/push/vapid-key:
 *      • Bez VAPID_PUBLIC_KEY env → { configured: false }
 *      • S env → { configured: true, publicKey: "..." }
 *   2) POST /api/buyer/push/subscribe bez auth → 401
 *   3) POST se valid body + x-user-id → 200 + id
 *   4) DELETE odstraní (returning deleted count)
 *
 * UI opt-in flow vyžaduje browser permission prompt — neumíme spolehlivě
 * v headless Playwright, takže smoke jen ověří že komponenta čeká 8s
 * a respektuje NotConfigured (žádný banner pokud VAPID env chybí).
 */
import { test, expect, type BrowserContext } from '@playwright/test';

const BUYER_EMAIL = 'anna.nova@example.cz';
const BUYER_PASSWORD = 'Demo2026!';

async function apiLogin(
  context: BrowserContext,
): Promise<{ accessToken: string; userId: string }> {
  const r = await context.request.post('/api/auth/login', {
    data: { email: BUYER_EMAIL, password: BUYER_PASSWORD },
  });
  const body = (await r.json()) as { accessToken: string; user: { id: string } };
  return { accessToken: body.accessToken, userId: body.user.id };
}

test('Push: VAPID key endpoint vrátí configured stav', async ({ context }) => {
  const r = await context.request.get('/api/public/push/vapid-key');
  expect(r.status()).toBe(200);
  const body = (await r.json()) as { configured: boolean; publicKey?: string };
  expect(typeof body.configured).toBe('boolean');
  // V CI/dev VAPID env typicky chybí → configured=false. Pokud nakonfigurované,
  // publicKey nesmí být prázdný string.
  if (body.configured) {
    expect(body.publicKey).toBeTruthy();
    expect(body.publicKey!.length).toBeGreaterThan(40);
  }
});

test('Push subscribe: bez x-user-id → 401', async ({ context }) => {
  const r = await context.request.post('/api/buyer/push/subscribe', {
    headers: { 'Content-Type': 'application/json' },
    data: {
      endpoint: 'https://fcm.googleapis.com/test',
      keys: { p256dh: 'a'.repeat(80), auth: 'b'.repeat(20) },
    },
  });
  expect(r.status()).toBe(401);
});

test('Push subscribe: validace bad input → 422', async ({ context }) => {
  const buyer = await apiLogin(context);
  const r = await context.request.post('/api/buyer/push/subscribe', {
    headers: { 'Content-Type': 'application/json', 'x-user-id': buyer.userId },
    data: { endpoint: 'not-a-url', keys: {} },
  });
  expect(r.status()).toBe(422);
});

test('Push subscribe: full lifecycle (subscribe → delete)', async ({ context }) => {
  const buyer = await apiLogin(context);
  const endpoint = `https://fcm.googleapis.com/test-${Date.now()}`;
  const validBody = {
    endpoint,
    keys: { p256dh: 'a'.repeat(80), auth: 'b'.repeat(20) },
  };

  // Subscribe
  const sub = await context.request.post('/api/buyer/push/subscribe', {
    headers: { 'Content-Type': 'application/json', 'x-user-id': buyer.userId },
    data: validBody,
  });
  expect(sub.status()).toBe(200);
  const subBody = (await sub.json()) as { ok: boolean; id: string };
  expect(subBody.ok).toBe(true);
  expect(subBody.id).toBeTruthy();

  // Idempotent upsert (re-subscribe same endpoint → updates row)
  const reSub = await context.request.post('/api/buyer/push/subscribe', {
    headers: { 'Content-Type': 'application/json', 'x-user-id': buyer.userId },
    data: validBody,
  });
  expect(reSub.status()).toBe(200);

  // Delete
  const del = await context.request.delete('/api/buyer/push/subscribe', {
    headers: { 'Content-Type': 'application/json', 'x-user-id': buyer.userId },
    data: { endpoint },
  });
  expect(del.status()).toBe(200);
  const delBody = (await del.json()) as { ok: boolean; deleted: number };
  expect(delBody.deleted).toBe(1);

  // Re-delete → 0
  const reDel = await context.request.delete('/api/buyer/push/subscribe', {
    headers: { 'Content-Type': 'application/json', 'x-user-id': buyer.userId },
    data: { endpoint },
  });
  expect(reDel.status()).toBe(200);
  const reDelBody = (await reDel.json()) as { deleted: number };
  expect(reDelBody.deleted).toBe(0);
});

test('Push UI: prompt skrytý pokud VAPID env chybí (configured=false)', async ({
  page,
  context,
}) => {
  const buyer = await apiLogin(context);

  await context.addInitScript(
    ({ uid, token }: { uid: string; token: string }) => {
      window.localStorage.setItem('userId', uid);
      window.localStorage.setItem('accessToken', token);
      window.localStorage.removeItem('tixly.push-dismissed-at');
    },
    { uid: buyer.userId, token: buyer.accessToken },
  );

  await page.goto('/cs/events');
  await page.waitForLoadState('networkidle');

  // Komponenta čeká 8s před zobrazením + jen pokud VAPID configured.
  // V dev/CI VAPID typicky chybí → prompt nikdy nezobrazen.
  // Krátký timeout — pokud configured=false, prompt nepřijde nikdy.
  const vapidRes = await context.request.get('/api/public/push/vapid-key');
  const vapidBody = (await vapidRes.json()) as { configured: boolean };

  if (!vapidBody.configured) {
    // Wait 9.5s aby uplynul 8s setTimeout a nějaké React render
    await page.waitForTimeout(9500);
    const promptCount = await page.getByTestId('push-optin-prompt').count();
    expect(promptCount).toBe(0);
  } else {
    // VAPID configured → prompt by se měl ukázat
    await expect(page.getByTestId('push-optin-prompt')).toBeVisible({
      timeout: 12000,
    });
  }
});
