/**
 * Golden Path: MHD Kombi-Ticket (DACH parity #10, München Ticket MVV pattern)
 *
 * Tixly massive city moat — žádná česká platforma to nemá. Tech triv,
 * business lead (DPP partnership) je měsíce. V mock režimu (žádné
 * DPP_API_KEY v env): SDK vrátí valid-looking QR s HMAC signature.
 *
 * Flow:
 *   1. Promotér PATCH /api/admin/events/[id]/transit-combo (partner+zones)
 *   2. Buyer koupí + zaplatí
 *   3. GET /api/buyer/orders/[orderId]/transit-pass → DPP QR vygenerován
 *      + uložen v orders.transit_passes
 *   4. Re-GET → alreadyIssued=true (idempotent)
 *   5. Signature verify (lokální HMAC, ne DPP API call)
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

test('MHD Kombi: promotér config → buyer koupí → pass se vygeneruje', async ({
  context,
}) => {
  await presetCookieConsent(context);
  const promoterToken = await apiLogin(context, PROMOTER_EMAIL, PROMOTER_PASSWORD);
  const buyerToken = await apiLogin(context, BUYER_EMAIL, BUYER_PASSWORD);
  const { eventId, ticketTypeId } = await findUsableEvent(context, promoterToken);

  const promoterHeaders = {
    Authorization: `Bearer ${promoterToken}`,
    'Content-Type': 'application/json',
  };

  // 1. Promotér zapne transit combo: DPP, zóny P+0+B (centrum Prahy)
  await test.step('1. PATCH transit-combo: DPP + zóny P, 0, B', async () => {
    const r = await context.request.patch(
      `/api/admin/events/${eventId}/transit-combo`,
      {
        headers: promoterHeaders,
        data: {
          partnerSlug: 'dpp',
          zones: ['P', '0', 'B'],
          enabled: true,
        },
      },
    );
    if (r.status() !== 200) {
      throw new Error(`Save combo failed: ${r.status()} ${await r.text()}`);
    }

    const getR = await context.request.get(
      `/api/admin/events/${eventId}/transit-combo`,
      { headers: promoterHeaders },
    );
    const body = (await getR.json()) as {
      combo: { partnerSlug: string; zones: string[]; enabled: boolean } | null;
    };
    expect(body.combo).not.toBeNull();
    expect(body.combo!.partnerSlug).toBe('dpp');
    expect(body.combo!.zones).toEqual(['P', '0', 'B']);
    expect(body.combo!.enabled).toBe(true);
  });

  // 2. Buyer koupí + zaplatí
  let orderId = '';
  await test.step('2. Buyer koupí + zaplatí', async () => {
    const checkoutRes = await context.request.post('/api/checkout', {
      headers: { 'Content-Type': 'application/json' },
      data: {
        eventId,
        ticketTypeId,
        quantity: 1,
        buyerEmail: BUYER_EMAIL,
        buyerName: 'Anna Nova',
      },
    });
    if (checkoutRes.status() >= 400) {
      throw new Error(`Checkout failed: ${await checkoutRes.text()}`);
    }
    const body = (await checkoutRes.json()) as {
      orderId: string;
      paymentId: string;
    };
    orderId = body.orderId;
    const pay = await context.request.post(`/api/mock-gopay/${body.paymentId}`, {
      data: { action: 'pay' },
    });
    expect(pay.status()).toBe(200);
  });

  // 3. GET transit pass — generuje + vrátí
  let qrPayload = '';
  await test.step('3. Buyer GET transit-pass → QR + signature', async () => {
    const r = await context.request.get(
      `/api/buyer/orders/${orderId}/transit-pass`,
      { headers: { Authorization: `Bearer ${buyerToken}` } },
    );
    if (r.status() !== 200) {
      throw new Error(`Pass failed: ${r.status()} ${await r.text()}`);
    }
    const body = (await r.json()) as {
      qrPayload: string;
      zones: string[];
      validFrom: string;
      validUntil: string;
      partnerName: string;
      partnerSlug: string;
      isMock: boolean;
      alreadyIssued: boolean;
    };
    expect(body.qrPayload).toMatch(/^tixly-mhd:dpp:[0-9a-f-]{36}:[0-9a-f]{32}$/);
    expect(body.zones).toEqual(['P', '0', 'B']);
    expect(body.partnerSlug).toBe('dpp');
    expect(body.partnerName).toMatch(/Pra[hž]/i); // "Praha" / "Pražská"
    expect(body.isMock).toBe(true);
    expect(body.alreadyIssued).toBe(false);
    qrPayload = body.qrPayload;
  });

  // 4. Re-GET → alreadyIssued=true, stejný qrPayload (idempotent)
  await test.step('4. Re-GET → idempotent (alreadyIssued=true)', async () => {
    const r = await context.request.get(
      `/api/buyer/orders/${orderId}/transit-pass`,
      { headers: { Authorization: `Bearer ${buyerToken}` } },
    );
    expect(r.status()).toBe(200);
    const body = (await r.json()) as {
      qrPayload: string;
      alreadyIssued: boolean;
    };
    expect(body.alreadyIssued).toBe(true);
    expect(body.qrPayload).toBe(qrPayload);
  });
});

test('MHD Kombi: invalid zones (mimo partner) → 422 INVALID_ZONES', async ({
  context,
}) => {
  const promoterToken = await apiLogin(context, PROMOTER_EMAIL, PROMOTER_PASSWORD);
  const { eventId } = await findUsableEvent(context, promoterToken);

  const r = await context.request.patch(
    `/api/admin/events/${eventId}/transit-combo`,
    {
      headers: {
        Authorization: `Bearer ${promoterToken}`,
        'Content-Type': 'application/json',
      },
      data: {
        partnerSlug: 'dpp',
        zones: ['XYZ', 'P'], // 'XYZ' není v DPP available_zones (P/0/B/1-5)
        enabled: true,
      },
    },
  );
  expect(r.status()).toBe(422);
  const body = (await r.json()) as { error: string };
  expect(body.error).toBe('INVALID_ZONES');
});

test('MHD Kombi: order BEZ transit combo → 404 NO_TRANSIT_COMBO', async ({
  context,
}) => {
  const promoterToken = await apiLogin(context, PROMOTER_EMAIL, PROMOTER_PASSWORD);
  const buyerToken = await apiLogin(context, BUYER_EMAIL, BUYER_PASSWORD);
  // Najdi event a vypni jeho combo (pokud existuje)
  const { eventId, ticketTypeId } = await findUsableEvent(context, promoterToken);

  await context.request.patch(`/api/admin/events/${eventId}/transit-combo`, {
    headers: {
      Authorization: `Bearer ${promoterToken}`,
      'Content-Type': 'application/json',
    },
    data: { partnerSlug: 'dpp', zones: ['P'], enabled: false },
  });

  const checkoutRes = await context.request.post('/api/checkout', {
    headers: { 'Content-Type': 'application/json' },
    data: {
      eventId,
      ticketTypeId,
      quantity: 1,
      buyerEmail: BUYER_EMAIL,
      buyerName: 'Anna Nova',
    },
  });
  if (checkoutRes.status() >= 400) {
    throw new Error(`Checkout failed: ${await checkoutRes.text()}`);
  }
  const { orderId, paymentId } = (await checkoutRes.json()) as {
    orderId: string;
    paymentId: string;
  };
  await context.request.post(`/api/mock-gopay/${paymentId}`, {
    data: { action: 'pay' },
  });

  const r = await context.request.get(
    `/api/buyer/orders/${orderId}/transit-pass`,
    { headers: { Authorization: `Bearer ${buyerToken}` } },
  );
  expect(r.status()).toBe(404);
  const body = (await r.json()) as { error: string };
  expect(body.error).toBe('NO_TRANSIT_COMBO');
});
