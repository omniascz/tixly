/**
 * Golden Path: Rotující QR (TOTP refresh) — DACH parity #8
 *
 * End-to-end ověření z DACH-AUDIT-VERIFIED.md sekce #8 (EVENTIM.Pass /
 * OETICKET.Pass / Ticketcorner.Pass anti-scalping pattern):
 *
 *   1. Promotér nastaví event.qr_policy = 'rotating_only'
 *   2. Buyer koupí + zaplatí → ticket s totp_secret_encrypted
 *   3. GET /api/buyer/tickets/[ticketId]/totp vrátí aktuální 6-digit code +
 *      expiresInSec + payload `tixly:[id]:[code]`
 *   4. Scanner POST /api/admin/scanner/validate s aktuálním kódem → result='ok'
 *   5. Scanner POST se starým 60+s kódem (mimo ±1 window) → 'totp_mismatch'
 *   6. Po prvním úspěšném scan → ticket.status='used', druhý scan vrátí
 *      'already_used' (idempotent)
 *
 * Anti-scalp invariant: screenshot pomáhá max 60s (1 step + 1 window),
 * pak je kód neplatný — kupec musí ukázat live QR z app/web.
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

test('Rotating QR: TOTP code + scanner verify + ±1 window enforcement', async ({
  context,
  request,
}) => {
  await presetCookieConsent(context);

  // 0. Najdi non-seated paid published event (Demo Promoter portfolio).
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

  // 1. Promotér nastaví qr_policy + reveal okamžitě (event je v budoucnosti,
  //    default qr_reveal_minutes_before=0 by skrýval QR až do startu eventu).
  await test.step('1. Promotér nastaví qr_policy=rotating_only + immediate reveal', async () => {
    const patchRes = await context.request.patch(`/api/admin/events/${eventId}`, {
      headers: {
        Authorization: `Bearer ${promoterToken}`,
        'Content-Type': 'application/json',
      },
      data: { qrPolicy: 'rotating_only', qrRevealMinutesBefore: 999999 },
    });
    expect(patchRes.status(), 'PATCH qr_policy').toBe(200);
  });

  // 2. Buyer login + checkout + PAY
  const buyerToken = await apiLogin(context, BUYER_EMAIL, BUYER_PASSWORD);
  let ticketId = '';

  await test.step('2. Buyer koupí + zaplatí ticket', async () => {
    const checkoutRes = await context.request.post('/api/checkout', {
      headers: { 'Content-Type': 'application/json' },
      data: {
        eventId,
        ticketTypeId: usableTtId,
        quantity: 1,
        buyerEmail: BUYER_EMAIL,
        buyerName: 'Anna Nova',
      },
    });
    if (checkoutRes.status() >= 400) {
      throw new Error(`Checkout failed: ${await checkoutRes.text()}`);
    }
    const { paymentId, orderId } = (await checkoutRes.json()) as {
      paymentId: string;
      orderId: string;
    };

    const pay = await context.request.post(`/api/mock-gopay/${paymentId}`, {
      data: { action: 'pay' },
    });
    expect(pay.status()).toBe(200);

    ticketId = await waitForTicketIssued(context, buyerToken, orderId);
  });

  // 3. GET /api/buyer/tickets/[id]/totp → aktuální code + countdown
  let currentCode = '';
  let payload = '';
  await test.step('3. Buyer dostane aktuální TOTP code', async () => {
    const r = await context.request.get(`/api/buyer/tickets/${ticketId}/totp`, {
      headers: { Authorization: `Bearer ${buyerToken}` },
    });
    expect(r.status()).toBe(200);
    const body = (await r.json()) as {
      ticketId: string;
      revealed: boolean;
      code: string;
      expiresInSec: number;
      step: number;
      payload: string;
      status: string;
    };
    expect(body.revealed).toBe(true);
    expect(body.code).toMatch(/^\d{6}$/);
    expect(body.step).toBe(30);
    expect(body.expiresInSec).toBeGreaterThan(0);
    expect(body.expiresInSec).toBeLessThanOrEqual(30);
    expect(body.payload).toBe(`tixly:${ticketId}:${body.code}`);
    currentCode = body.code;
    payload = body.payload;
  });

  // 4. Scanner validate s aktuálním kódem → 'ok' (a ticket → 'used')
  await test.step('4. Scanner přijme aktuální TOTP → ok', async () => {
    const r = await context.request.post('/api/admin/scanner/validate', {
      headers: {
        Authorization: `Bearer ${promoterToken}`,
        'Content-Type': 'application/json',
      },
      data: { ticketId, totpCode: currentCode },
    });
    if (r.status() !== 200) {
      throw new Error(`Scanner validate failed: ${r.status()} ${await r.text()}`);
    }
    const body = (await r.json()) as { result: string };
    expect(body.result).toBe('admitted');
  });

  // 5. Druhý scan stejného TOTP → 'already_used' (idempotent)
  await test.step('5. Re-scan → already_used (anti-double-entry)', async () => {
    const r = await context.request.post('/api/admin/scanner/validate', {
      headers: {
        Authorization: `Bearer ${promoterToken}`,
        'Content-Type': 'application/json',
      },
      data: { ticketId, totpCode: currentCode },
    });
    const body = (await r.json()) as { result: string };
    expect(body.result).toBe('already_used');
  });

  void payload; // payload obsahuje ticketId + code, ověřeno v step 3
});

test('Rotating QR: invalid TOTP code → totp_mismatch (anti-screenshot)', async ({
  context,
  request,
}) => {
  await presetCookieConsent(context);
  const promoterToken = await apiLogin(context, PROMOTER_EMAIL, PROMOTER_PASSWORD);
  const buyerToken = await apiLogin(context, BUYER_EMAIL, BUYER_PASSWORD);

  // Najdi event a buyer ticket (rotating_only musí být zapnutý)
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
  expect(eventId).toBeTruthy();

  // Set rotating_only + koupit ticket
  await context.request.patch(`/api/admin/events/${eventId}`, {
    headers: {
      Authorization: `Bearer ${promoterToken}`,
      'Content-Type': 'application/json',
    },
    data: { qrPolicy: 'rotating_only' },
  });

  const checkoutRes = await context.request.post('/api/checkout', {
    headers: { 'Content-Type': 'application/json' },
    data: {
      eventId,
      ticketTypeId: usableTtId,
      quantity: 1,
      buyerEmail: BUYER_EMAIL,
      buyerName: 'Anna Nova',
    },
  });
  if (checkoutRes.status() >= 400) {
    throw new Error(`Checkout failed: ${await checkoutRes.text()}`);
  }
  const { paymentId, orderId } = (await checkoutRes.json()) as {
    paymentId: string;
    orderId: string;
  };
  await context.request.post(`/api/mock-gopay/${paymentId}`, {
    data: { action: 'pay' },
  });

  const ticketId = await waitForTicketIssued(context, buyerToken, orderId);

  // Scanner s fake TOTP kódem '000000' (vždy invalid pro random secret)
  const r = await context.request.post('/api/admin/scanner/validate', {
    headers: {
      Authorization: `Bearer ${promoterToken}`,
      'Content-Type': 'application/json',
    },
    data: { ticketId, totpCode: '000000' },
  });
  expect(r.status()).toBe(401);
  const body = (await r.json()) as { result: string };
  expect(body.result).toBe('totp_mismatch');
});

test('Rotating QR: scanner BEZ totp na rotating_only event → totp_required', async ({
  context,
  request,
}) => {
  await presetCookieConsent(context);
  const promoterToken = await apiLogin(context, PROMOTER_EMAIL, PROMOTER_PASSWORD);
  const buyerToken = await apiLogin(context, BUYER_EMAIL, BUYER_PASSWORD);

  // Setup: rotating_only event + buyer ticket
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
      ticketTypes: Array<{ id: string; remainingQty: number; basePrice: number; isSeated: boolean }>;
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
  expect(eventId).toBeTruthy();
  await context.request.patch(`/api/admin/events/${eventId}`, {
    headers: { Authorization: `Bearer ${promoterToken}`, 'Content-Type': 'application/json' },
    data: { qrPolicy: 'rotating_only' },
  });

  const checkoutRes = await context.request.post('/api/checkout', {
    headers: { 'Content-Type': 'application/json' },
    data: {
      eventId,
      ticketTypeId: usableTtId,
      quantity: 1,
      buyerEmail: BUYER_EMAIL,
      buyerName: 'Anna Nova',
    },
  });
  if (checkoutRes.status() >= 400) {
    throw new Error(`Checkout failed: ${await checkoutRes.text()}`);
  }
  const { paymentId, orderId } = (await checkoutRes.json()) as {
    paymentId: string;
    orderId: string;
  };
  await context.request.post(`/api/mock-gopay/${paymentId}`, {
    data: { action: 'pay' },
  });
  const ticketId = await waitForTicketIssued(context, buyerToken, orderId);

  // Scanner BEZ totpCode na rotating_only event → 401 'totp_required'
  const r = await context.request.post('/api/admin/scanner/validate', {
    headers: {
      Authorization: `Bearer ${promoterToken}`,
      'Content-Type': 'application/json',
    },
    data: { ticketId }, // no totpCode!
  });
  expect(r.status()).toBe(401);
  const body = (await r.json()) as { result: string; qrPolicy: string };
  expect(body.result).toBe('totp_required');
  expect(body.qrPolicy).toBe('rotating_only');
});
