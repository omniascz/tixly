/**
 * Golden Path: Benefit Pay providers (Pluxee/Sodexo/Benefit Plus/Edenred)
 *
 * DACH parity #9 (CZ-specific employer benefit cards). Tixly hodnota: unlock
 * korporátní benefit budget jako payment source — žádná CZ ticketing platforma
 * to nemá integrované přes API (ručně přes faktury).
 *
 * Mock mode (default — žádné PLUXEE_API_KEY / EDENRED_API_KEY v env):
 *   1. Checkout s paymentMethod=pluxee → orders.benefit_payments row +
 *      redirect na /mock-benefit/pluxee/[externalId]
 *   2. Buyer na mock vendor portal klikne "Zaplatit" → POST callback API
 *   3. Callback marks benefit_payment + order jako paid, fire-and-forget
 *      trigger order-completed → ticket vystaven
 *   4. Buyer redirected na /cs/order-confirmation/[orderId]
 *
 * Plus cancel flow + idempotent re-callback test.
 */
import { test, expect, type BrowserContext } from '@playwright/test';

const PROMOTER_EMAIL = 'admin@tixly.cz';
const PROMOTER_PASSWORD = 'Demo2026!';
const BUYER_EMAIL = 'anna.nova@example.cz';
const BUYER_PASSWORD = 'Demo2026!';

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

async function apiLogin(
  context: BrowserContext,
  email: string,
  password: string,
): Promise<string> {
  const res = await context.request.post('/api/auth/login', {
    data: { email, password },
  });
  if (res.status() !== 200) {
    throw new Error(`Login failed for ${email} (${res.status()}): ${await res.text()}`);
  }
  return ((await res.json()) as { accessToken: string }).accessToken;
}

async function findUsableEvent(
  context: BrowserContext,
  promoterToken: string,
): Promise<{ eventId: string; ticketTypeId: string }> {
  const eventsRes = await context.request.get('/api/admin/events', {
    headers: { Authorization: `Bearer ${promoterToken}` },
  });
  const body = (await eventsRes.json()) as
    | Array<{ id: string; moderationStatus?: string }>
    | { events?: Array<{ id: string; moderationStatus?: string }> };
  const events = Array.isArray(body) ? body : (body.events ?? []);
  const candidates = events.filter(
    (e) => e.moderationStatus === 'published' || !e.moderationStatus,
  );
  for (const ev of candidates) {
    const ttRes = await context.request.get(`/api/events/${ev.id}/ticket-types`);
    if (!ttRes.ok()) continue;
    const tt = (await ttRes.json()) as {
      ticketTypes: Array<{
        id: string;
        remainingQty: number;
        basePrice: number;
        isSeated: boolean;
      }>;
    };
    const usable = tt.ticketTypes.find(
      (t) => !t.isSeated && t.remainingQty > 0 && t.basePrice > 0,
    );
    if (usable) return { eventId: ev.id, ticketTypeId: usable.id };
  }
  throw new Error('No usable event found');
}

async function waitForTicketIssued(
  context: BrowserContext,
  buyerToken: string,
  orderId: string,
): Promise<string> {
  for (let i = 0; i < 12; i++) {
    const res = await context.request.get('/api/buyer/my-tickets', {
      headers: { Authorization: `Bearer ${buyerToken}` },
    });
    const { tickets } = (await res.json()) as {
      tickets: Array<{ id: string; order_id: string }>;
    };
    const t = tickets.find((x) => x.order_id === orderId);
    if (t) return t.id;
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error(`Ticket pro order ${orderId} nebyl vystaven do 6s`);
}

test.beforeAll(async ({ request }) => {
  // Warm up: kompilace mock-benefit cesty v dev serveru (cold first compile ~10s).
  await request.get('/mock-benefit/pluxee/warmup');
});

test('Benefit Pay (Pluxee): checkout → mock portal → "Zaplatit" → ticket', async ({
  page,
  context,
}) => {
  await presetCookieConsent(context);
  const promoterToken = await apiLogin(context, PROMOTER_EMAIL, PROMOTER_PASSWORD);
  const buyerToken = await apiLogin(context, BUYER_EMAIL, BUYER_PASSWORD);
  const { eventId, ticketTypeId } = await findUsableEvent(context, promoterToken);

  let orderId = '';
  let paymentId = '';
  let gatewayUrl = '';

  await test.step('1. Checkout s paymentMethod=pluxee → redirect URL', async () => {
    const res = await context.request.post('/api/checkout', {
      headers: { 'Content-Type': 'application/json' },
      data: {
        eventId,
        ticketTypeId,
        quantity: 1,
        buyerEmail: BUYER_EMAIL,
        buyerName: 'Anna Nova',
        paymentMethod: 'pluxee',
      },
    });
    if (res.status() >= 400) {
      throw new Error(`Checkout failed: ${res.status()} ${await res.text()}`);
    }
    const body = (await res.json()) as {
      orderId: string;
      paymentId: string;
      gatewayUrl: string;
      provider: string;
    };
    expect(body.provider).toBe('pluxee');
    expect(body.gatewayUrl).toContain('/mock-benefit/pluxee/');
    orderId = body.orderId;
    paymentId = body.paymentId;
    gatewayUrl = body.gatewayUrl;
  });

  await test.step('2. Buyer otevře mock vendor portal', async () => {
    await page.goto(gatewayUrl, { waitUntil: 'domcontentloaded' });
    await expect(page.getByTestId('benefit-vendor-header')).toBeVisible();
    await expect(page.getByTestId('benefit-vendor-header')).toContainText(/Pluxee/i);
    await expect(page.getByTestId('benefit-external-id')).toContainText(paymentId);
    // Čekat na hydraci — button musí být interactive (React onClick attached).
    await expect(page.getByTestId('benefit-pay')).toBeEnabled({ timeout: 5_000 });
  });

  await test.step('3. Klik "Zaplatit" → callback → order=paid', async () => {
    // Zachytíme network response paralelně s klikem
    const [callbackResp] = await Promise.all([
      page.waitForResponse(
        (r) =>
          r.url().includes('/api/payments/benefit/callback') &&
          r.request().method() === 'POST',
        { timeout: 15_000 },
      ),
      page.getByTestId('benefit-pay').click(),
    ]);
    expect(callbackResp.status(), 'Callback HTTP status').toBe(200);

    // Po success: stav done='paid' → "Zaplaceno benefitní kartou" → setTimeout(1500ms) router.push
    await expect(page.getByText(/Zaplaceno benefitní kartou/i)).toBeVisible({
      timeout: 5_000,
    });
    // Pak 1.5s redirect na order-confirmation
    await page.waitForURL(/\/cs\/order-confirmation\/[0-9a-f-]{36}/, {
      timeout: 15_000,
    });
  });

  await test.step('4. Ticket vystaven + DB state', async () => {
    const ticketId = await waitForTicketIssued(context, buyerToken, orderId);
    expect(ticketId).toBeTruthy();

    // Verify benefit_payment status=paid
    const orderRes = await context.request.get('/api/buyer/my-tickets', {
      headers: { Authorization: `Bearer ${buyerToken}` },
    });
    const { tickets } = (await orderRes.json()) as {
      tickets: Array<{ id: string; order_id: string; order_status: string }>;
    };
    const ticket = tickets.find((t) => t.order_id === orderId)!;
    expect(ticket.order_status).toBe('paid');
  });
});

test('Benefit Pay: idempotent callback — duplicate ignoruje', async ({ context }) => {
  await presetCookieConsent(context);
  const promoterToken = await apiLogin(context, PROMOTER_EMAIL, PROMOTER_PASSWORD);
  const { eventId, ticketTypeId } = await findUsableEvent(context, promoterToken);

  const checkoutRes = await context.request.post('/api/checkout', {
    headers: { 'Content-Type': 'application/json' },
    data: {
      eventId,
      ticketTypeId,
      quantity: 1,
      buyerEmail: 'benefit-idempotent@example.cz',
      buyerName: 'Idempotent Test',
      paymentMethod: 'edenred',
    },
  });
  if (checkoutRes.status() >= 400) {
    throw new Error(`Checkout failed: ${await checkoutRes.text()}`);
  }
  const { paymentId } = (await checkoutRes.json()) as {
    orderId: string;
    paymentId: string;
  };

  // První callback: paid
  const first = await context.request.post('/api/payments/benefit/callback', {
    headers: { 'Content-Type': 'application/json' },
    data: { provider: 'edenred', externalId: paymentId, success: true, payload: {} },
  });
  expect(first.status()).toBe(200);
  const firstBody = (await first.json()) as { status: string };
  expect(firstBody.status).toBe('paid');

  // Druhý callback: duplicate
  const second = await context.request.post('/api/payments/benefit/callback', {
    headers: { 'Content-Type': 'application/json' },
    data: { provider: 'edenred', externalId: paymentId, success: true, payload: {} },
  });
  expect(second.status()).toBe(200);
  const secondBody = (await second.json()) as { status: string };
  expect(secondBody.status).toBe('duplicate');
});

test('Benefit Pay: callback s neplatným externalId → 404', async ({ context }) => {
  const res = await context.request.post('/api/payments/benefit/callback', {
    headers: { 'Content-Type': 'application/json' },
    data: {
      provider: 'pluxee',
      externalId: '00000000-0000-0000-0000-000000000000',
      success: true,
      payload: {},
    },
  });
  expect(res.status()).toBe(404);
  const body = (await res.json()) as { error: string };
  expect(body.error).toBe('PAYMENT_NOT_FOUND');
});

