/**
 * Golden Path: Twisto / Skip Pay BNPL (CZ priority #2, ROI 8/10)
 *
 * Tixly checkout přijme paymentMethod='twisto' nebo 'skippay', vrátí gateway
 * URL /mock-bnpl/[provider]/[paymentId]. Mock provider page buyer schválí →
 * order paid + tickety vystavené (přes existing /api/internal/order-completed).
 *
 * V produkci by Tixly volal Twisto API (POST /credit-check) + Skip Pay API.
 *
 * Flow:
 *   1. POST /api/checkout s paymentMethod='twisto' → gatewayUrl
 *   2. POST /api/mock-bnpl/twisto/[id]/confirm action='approve' → order paid
 *   3. Re-confirm → "Already paid"
 *   4. Reject → status=cancelled
 *   5. Skip Pay parity
 *   6. UI page renderuje installments selector
 */
import { test, expect, type BrowserContext } from '@playwright/test';

async function getUsableEvent(
  context: BrowserContext,
): Promise<{ eventId: string; ticketTypeId: string; basePrice: number }> {
  const l = await context.request.post('/api/auth/login', {
    data: { email: 'admin@tixly.cz', password: 'Demo2026!' },
  });
  const { accessToken } = (await l.json()) as { accessToken: string };
  const r = await context.request.get('/api/admin/events', {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  const body = (await r.json()) as
    | Array<{ id: string; moderationStatus?: string }>
    | { events?: Array<{ id: string; moderationStatus?: string }> };
  const events = Array.isArray(body) ? body : (body.events ?? []);
  for (const ev of events) {
    if (ev.moderationStatus && ev.moderationStatus !== 'published') continue;
    const tt = await context.request.get(`/api/events/${ev.id}/ticket-types`);
    if (!tt.ok()) continue;
    const ttBody = (await tt.json()) as {
      ticketTypes: Array<{ id: string; remainingQty: number; basePrice: number; isSeated: boolean }>;
    };
    const usable = ttBody.ticketTypes.find(
      (t) => !t.isSeated && t.remainingQty > 0 && t.basePrice > 0,
    );
    if (usable) return { eventId: ev.id, ticketTypeId: usable.id, basePrice: usable.basePrice };
  }
  throw new Error('No usable GA event');
}

for (const provider of ['twisto', 'skippay'] as const) {
  test(`BNPL ${provider}: checkout → approve → order paid`, async ({ context }) => {
    const { eventId, ticketTypeId } = await getUsableEvent(context);

    const co = await context.request.post('/api/checkout', {
      headers: { 'Content-Type': 'application/json' },
      data: {
        eventId,
        ticketTypeId,
        quantity: 1,
        buyerEmail: `bnpl-${provider}-${Date.now()}@example.cz`,
        buyerName: 'BNPL Test',
        paymentMethod: provider,
      },
    });
    expect(co.status()).toBe(200);
    const body = (await co.json()) as {
      orderId: string;
      paymentId: string;
      gatewayUrl: string;
      provider: string;
    };
    expect(body.provider).toBe(provider);
    expect(body.gatewayUrl).toMatch(
      new RegExp(`/mock-bnpl/${provider}/[0-9a-f-]+`),
    );

    // Approve
    const r = await context.request.post(
      `/api/mock-bnpl/${provider}/${body.paymentId}/confirm`,
      {
        headers: { 'Content-Type': 'application/json' },
        data: { action: 'approve', installments: 3 },
      },
    );
    expect(r.status()).toBe(200);
    const rb = (await r.json()) as {
      orderId: string;
      status: string;
      installments: number;
      provider: string;
    };
    expect(rb.status).toBe('paid');
    expect(rb.installments).toBe(3);
    expect(rb.provider).toBe(provider);

    // Re-approve idempotent
    const reApprove = await context.request.post(
      `/api/mock-bnpl/${provider}/${body.paymentId}/confirm`,
      {
        headers: { 'Content-Type': 'application/json' },
        data: { action: 'approve' },
      },
    );
    expect(reApprove.status()).toBe(200);
    const reBody = (await reApprove.json()) as { message?: string };
    expect(reBody.message).toBe('Already paid');
  });
}

test('BNPL: reject → order cancelled', async ({ context }) => {
  const { eventId, ticketTypeId } = await getUsableEvent(context);

  const co = await context.request.post('/api/checkout', {
    headers: { 'Content-Type': 'application/json' },
    data: {
      eventId,
      ticketTypeId,
      quantity: 1,
      buyerEmail: `bnpl-reject-${Date.now()}@example.cz`,
      buyerName: 'BNPL Test',
      paymentMethod: 'twisto',
    },
  });
  const { paymentId } = (await co.json()) as { paymentId: string };

  const r = await context.request.post(
    `/api/mock-bnpl/twisto/${paymentId}/confirm`,
    {
      headers: { 'Content-Type': 'application/json' },
      data: { action: 'reject' },
    },
  );
  expect(r.status()).toBe(200);
  const body = (await r.json()) as { status: string };
  expect(body.status).toBe('cancelled');
});

test('BNPL: unknown provider → 400', async ({ context }) => {
  const r = await context.request.post(
    '/api/mock-bnpl/unknown/00000000-0000-4000-a000-000000000000/confirm',
    {
      headers: { 'Content-Type': 'application/json' },
      data: { action: 'approve' },
    },
  );
  expect(r.status()).toBe(400);
});

test('BNPL: invalid payment ID → 400', async ({ context }) => {
  const r = await context.request.post(
    '/api/mock-bnpl/twisto/not-a-uuid/confirm',
    {
      headers: { 'Content-Type': 'application/json' },
      data: { action: 'approve' },
    },
  );
  expect(r.status()).toBe(400);
});

test('BNPL UI: mock page renderuje installments selector', async ({
  page,
  context,
}) => {
  const { eventId, ticketTypeId } = await getUsableEvent(context);
  const co = await context.request.post('/api/checkout', {
    headers: { 'Content-Type': 'application/json' },
    data: {
      eventId,
      ticketTypeId,
      quantity: 1,
      buyerEmail: `bnpl-ui-${Date.now()}@example.cz`,
      buyerName: 'BNPL UI',
      paymentMethod: 'twisto',
    },
  });
  const { paymentId } = (await co.json()) as { paymentId: string };

  await page.goto(`/mock-bnpl/twisto/${paymentId}`);
  await page.waitForLoadState('domcontentloaded');

  await expect(page.getByText(/Twisto.*Splátky/)).toBeVisible();
  await expect(page.getByTestId('bnpl-installments-3')).toBeVisible();
  await expect(page.getByTestId('bnpl-installments-4')).toBeVisible();
  await expect(page.getByTestId('bnpl-installments-6')).toBeVisible();
  await expect(page.getByTestId('bnpl-approve')).toBeVisible();

  // Click 4 splátky → approve → success
  await page.getByTestId('bnpl-installments-4').click();
  await page.getByTestId('bnpl-approve').click();
  await expect(page.getByTestId('bnpl-success')).toBeVisible({ timeout: 10_000 });
  await expect(page.getByText(/4 splátky/)).toBeVisible();
});
