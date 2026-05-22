/**
 * Golden Path: Print marketing QR (DACH parity #5)
 *
 * End-to-end ověření z DACH-AUDIT-VERIFIED.md sekce #5 (EVENTIM.Light pattern):
 *   1. Promotér v /admin/events/[id]/marketing-qr vytvoří QR kampaň
 *   2. PNG download endpoint vrátí 600px PNG (image/png Content-Type)
 *   3. Klik na /api/qr/[slug] = redirect na /cs/events/[id] + cookie qr_ref
 *      + scan_count++
 *   4. Buyer dokončí checkout s cookie → order.qr_campaign_id linkne kampaň
 *   5. Mock-gopay PAY → conversion_count++ + conversion_total_halire++
 *
 * Demo Promoter (admin@tixly.cz) — má non-seated published eventy bez pending_review.
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

test('Marketing QR: vytvoření → scan → conversion attribution', async ({
  context,
  request,
}) => {
  await presetCookieConsent(context);

  // 0. Najdi non-seated paid published event z admin@tixly.cz portfolia.
  const promoterToken = await apiLogin(context, PROMOTER_EMAIL, PROMOTER_PASSWORD);
  const eventsRes = await request.get('/api/admin/events', {
    headers: { Authorization: `Bearer ${promoterToken}` },
  });
  const eventsBody = (await eventsRes.json()) as
    | Array<{ id: string; moderationStatus?: string }>
    | { events?: Array<{ id: string; moderationStatus?: string }> };
  const allEvents = Array.isArray(eventsBody) ? eventsBody : (eventsBody.events ?? []);
  const candidates = allEvents.filter(
    (e) => e.moderationStatus === 'published' || !e.moderationStatus,
  );

  let eventId = '';
  let usableTtId = '';
  for (const ev of candidates) {
    const ttRes = await request.get(`/api/events/${ev.id}/ticket-types`);
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
    if (usable) {
      eventId = ev.id;
      usableTtId = usable.id;
      break;
    }
  }
  expect(eventId, 'Nalezen non-seated paid published event').toBeTruthy();

  // 1. Vytvořit QR kampaň přes API
  const slug = `pwt-qr-${Date.now()}`;
  let campaignId = '';
  await test.step('1. POST /api/admin/events/[id]/marketing-qr', async () => {
    const res = await context.request.post(
      `/api/admin/events/${eventId}/marketing-qr`,
      {
        headers: {
          Authorization: `Bearer ${promoterToken}`,
          'Content-Type': 'application/json',
        },
        data: { name: 'Playwright Test Kampaň', slug, utmSource: 'test' },
      },
    );
    expect(res.status()).toBe(201);
    const body = (await res.json()) as { campaign: { id: string; slug: string } };
    expect(body.campaign.slug).toBe(slug);
    campaignId = body.campaign.id;
  });

  // 2. PNG download vrací image/png
  await test.step('2. GET PNG download', async () => {
    const res = await context.request.get(
      `/api/admin/events/${eventId}/marketing-qr/${campaignId}/png?size=600`,
      { headers: { Authorization: `Bearer ${promoterToken}` } },
    );
    expect(res.status()).toBe(200);
    expect(res.headers()['content-type']).toContain('image/png');
    const buf = await res.body();
    // PNG signature: 89 50 4E 47
    expect(buf[0]).toBe(0x89);
    expect(buf[1]).toBe(0x50);
    expect(buf[2]).toBe(0x4e);
    expect(buf[3]).toBe(0x47);
    expect(buf.length).toBeGreaterThan(500); // 600px QR ~několik kB
  });

  // 3. Scan tracker: GET /api/qr/[slug] → 302 redirect + cookie qr_ref + scan_count++
  let qrRefCookie = '';
  await test.step('3. Scan tracker: redirect + cookie + scan_count++', async () => {
    // Použijeme fresh context bez follow-redirects pro inspekci hlaviček
    const scanRes = await context.request.get(`/api/qr/${slug}`, {
      maxRedirects: 0,
      failOnStatusCode: false,
    });
    expect(scanRes.status()).toBe(302);
    const location = scanRes.headers()['location'];
    expect(location).toContain(`/cs/events/${eventId}`);
    expect(location).toContain('qr_ref=');
    expect(location).toContain('utm_source=test');

    const setCookie = scanRes.headers()['set-cookie'] ?? '';
    const m = setCookie.match(/qr_ref=([0-9a-f-]{36})/i);
    expect(m).toBeTruthy();
    qrRefCookie = m![1];
    expect(qrRefCookie).toBe(campaignId);

    // Počkat fire-and-forget scan_count update
    await new Promise((r) => setTimeout(r, 500));

    const listRes = await context.request.get(
      `/api/admin/events/${eventId}/marketing-qr`,
      { headers: { Authorization: `Bearer ${promoterToken}` } },
    );
    const list = (await listRes.json()) as {
      campaigns: Array<{ id: string; scanCount: number }>;
    };
    const found = list.campaigns.find((c) => c.id === campaignId);
    expect(found?.scanCount, 'scan_count > 0 po scan tracker').toBeGreaterThan(0);
  });

  // 4. Checkout s qr_ref → order linkne kampaň
  let orderId = '';
  let paymentId = '';
  await test.step('4. Checkout s qrRef → order.qr_campaign_id', async () => {
    const checkoutRes = await context.request.post('/api/checkout', {
      headers: { 'Content-Type': 'application/json' },
      data: {
        eventId,
        ticketTypeId: usableTtId,
        quantity: 1,
        buyerEmail: BUYER_EMAIL,
        buyerName: 'Anna Nova',
        qrRef: qrRefCookie,
      },
    });
    if (checkoutRes.status() >= 400) {
      const err = await checkoutRes.json();
      throw new Error(`Checkout failed: ${JSON.stringify(err)}`);
    }
    const body = (await checkoutRes.json()) as {
      orderId: string;
      paymentId: string;
    };
    orderId = body.orderId;
    paymentId = body.paymentId;
  });

  // 5. Mock-gopay PAY → conversion_count++
  await test.step('5. Mock-gopay PAY → conversion_count++', async () => {
    const pay = await context.request.post(`/api/mock-gopay/${paymentId}`, {
      data: { action: 'pay' },
    });
    expect(pay.status()).toBe(200);

    // Počkat fire-and-forget conversion update
    await new Promise((r) => setTimeout(r, 800));

    const listRes = await context.request.get(
      `/api/admin/events/${eventId}/marketing-qr`,
      { headers: { Authorization: `Bearer ${promoterToken}` } },
    );
    const list = (await listRes.json()) as {
      campaigns: Array<{
        id: string;
        scanCount: number;
        conversionCount: number;
        conversionTotalHalire: number;
        conversionRate: number;
      }>;
    };
    const found = list.campaigns.find((c) => c.id === campaignId)!;
    expect(found.conversionCount, 'conversion_count po PAY').toBeGreaterThanOrEqual(1);
    expect(found.conversionTotalHalire, 'conversion_total').toBeGreaterThan(0);
    expect(found.conversionRate).toBeGreaterThan(0);
  });

  void orderId; // referenced from order tracking elsewhere
});

test('Marketing QR: invalid slug → 302 redirect na /cs/events (no leak)', async ({
  context,
}) => {
  const scanRes = await context.request.get('/api/qr/this-does-not-exist-12345', {
    maxRedirects: 0,
    failOnStatusCode: false,
  });
  expect(scanRes.status()).toBe(302);
  expect(scanRes.headers()['location']).toMatch(/\/cs\/events$/);
});
