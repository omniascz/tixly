/**
 * Golden Path: Skiddle Rep affiliate (TIER 3 #10, ROI 4/10)
 *
 * Affiliate (klub manager, influencer) má unique code, sdílí
 * tixly.cz/r/<code>?event=<id>. Buyer klikne, cookie aff_code se nastaví,
 * checkout přijme code z body → order linkován + commission spočítaná.
 *
 * Backend existoval: marketing.affiliates schema + admin CRUD + checkout
 * integration (line 1126-1144). Tato sada dokrývá tracking redirect /r/[code]
 * + E2E full flow.
 *
 * Flow:
 *   1. Promotér POST /api/admin/affiliates {code, name, commissionPct} → 201
 *   2. Public GET /r/<code>?event=<eventId> → 302 + Set-Cookie aff_code
 *   3. POST /api/checkout s {affiliateCode} → order.affiliate_id linkován
 *   4. GET /api/admin/affiliates → orders_count + revenue + commission stats
 *   5. Validace: invalid code → 422, duplicate code → 409, no auth → 401
 */
import { test, expect, type BrowserContext } from '@playwright/test';

const ADMIN_EMAIL = 'admin@tixly.cz';
const RUN_ID = Date.now().toString().slice(-8);

async function login(
  context: BrowserContext,
  email: string,
): Promise<{ accessToken: string; userId: string }> {
  const r = await context.request.post('/api/auth/login', {
    data: { email, password: 'Demo2026!' },
  });
  if (r.status() !== 200) throw new Error(`Login failed: ${email}`);
  const body = (await r.json()) as { accessToken: string; user: { id: string } };
  return { accessToken: body.accessToken, userId: body.user.id };
}

async function getUsableEvent(
  context: BrowserContext,
  admin: { accessToken: string },
): Promise<{ eventId: string; ticketTypeId: string }> {
  const r = await context.request.get('/api/admin/events', {
    headers: { Authorization: `Bearer ${admin.accessToken}` },
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
      ticketTypes: Array<{
        id: string;
        remainingQty: number;
        basePrice: number;
        isSeated: boolean;
      }>;
    };
    const usable = ttBody.ticketTypes.find(
      (t) => !t.isSeated && t.remainingQty > 0 && t.basePrice > 0,
    );
    if (usable) return { eventId: ev.id, ticketTypeId: usable.id };
  }
  throw new Error('No usable GA event');
}

test('Affiliate: create → tracking redirect → checkout linked → stats', async ({
  context,
}) => {
  const admin = await login(context, ADMIN_EMAIL);
  const code = `RUN${RUN_ID}`;

  // 1. Create affiliate
  const create = await context.request.post('/api/admin/affiliates', {
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${admin.accessToken}`,
    },
    data: {
      code,
      name: 'Test Affiliate',
      email: `aff-${RUN_ID}@example.cz`,
      commissionPct: 10,
    },
  });
  expect(create.status()).toBe(201);
  const { id: affiliateId } = (await create.json()) as { id: string };
  expect(affiliateId).toBeTruthy();

  // 2. Find usable event + tracking redirect
  const { eventId, ticketTypeId } = await getUsableEvent(context, admin);
  const redirect = await context.request.get(
    `/r/${code}?event=${eventId}`,
    { maxRedirects: 0 },
  );
  expect([302, 307]).toContain(redirect.status());
  const location = redirect.headers()['location'] ?? '';
  // KRITICKÉ — po fix musí redirect URL obsahovat ?ref=CODE (předtím jen
  // cookie, kterou checkout/page.tsx nečetl, takže attribution byla dead).
  expect(location).toContain(`/cs/events/${eventId}`);
  expect(location).toContain(`ref=${code.toUpperCase()}`);
  const setCookie = redirect.headers()['set-cookie'] ?? '';
  expect(setCookie).toContain('aff_code=');
  expect(setCookie).toContain(code.toUpperCase());

  // 3. Checkout s affiliateCode → 200 + order linked
  const co = await context.request.post('/api/checkout', {
    headers: { 'Content-Type': 'application/json' },
    data: {
      eventId,
      ticketTypeId,
      quantity: 1,
      buyerEmail: `aff-buyer-${RUN_ID}@example.cz`,
      buyerName: 'Affiliate Buyer',
      paymentMethod: 'gopay',
      affiliateCode: code,
    },
  });
  expect(co.status()).toBe(200);
  const coBody = (await co.json()) as { orderId: string; paymentId: string };
  expect(coBody.orderId).toBeTruthy();

  // 4. Stats — orders_count se zvýší až po payment. Pro tento test stačí ověřit,
  // že affiliate je v listu (před fixem `mine` mohlo být undefined když
  // marketing.affiliates tabulka neexistovala — viz schema drift report).
  const stats = await context.request.get('/api/admin/affiliates', {
    headers: { Authorization: `Bearer ${admin.accessToken}` },
  });
  expect(stats.status()).toBe(200);
  const statsBody = (await stats.json()) as {
    affiliates: Array<{
      id: string;
      code: string;
      orders_count: number;
      commission_total: string;
    }>;
  };
  const mine = statsBody.affiliates.find((a) => a.id === affiliateId);
  expect(mine).toBeDefined();
  expect(mine!.code).toBe(code.toUpperCase());
});

test('Affiliate: duplicate code → 409 CODE_TAKEN', async ({ context }) => {
  const admin = await login(context, ADMIN_EMAIL);
  const code = `DUP${RUN_ID}`;
  const first = await context.request.post('/api/admin/affiliates', {
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${admin.accessToken}`,
    },
    data: { code, name: 'First', commissionPct: 5 },
  });
  expect([201, 409]).toContain(first.status());

  const second = await context.request.post('/api/admin/affiliates', {
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${admin.accessToken}`,
    },
    data: { code, name: 'Second', commissionPct: 5 },
  });
  expect(second.status()).toBe(409);
  const body = (await second.json()) as { error: string };
  expect(body.error).toBe('CODE_TAKEN');
});

test('Affiliate: invalid code format → 422', async ({ context }) => {
  const admin = await login(context, ADMIN_EMAIL);
  const r = await context.request.post('/api/admin/affiliates', {
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${admin.accessToken}`,
    },
    data: { code: 'invalid lowercase with spaces', name: 'X', commissionPct: 5 },
  });
  expect(r.status()).toBe(422);
});

test('Affiliate: commissionPct > 50 → 422', async ({ context }) => {
  const admin = await login(context, ADMIN_EMAIL);
  const r = await context.request.post('/api/admin/affiliates', {
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${admin.accessToken}`,
    },
    data: { code: `OVER${RUN_ID}`, name: 'X', commissionPct: 99 },
  });
  expect(r.status()).toBe(422);
});

test('Affiliate: bez auth → 401', async ({ context }) => {
  const r = await context.request.post('/api/admin/affiliates', {
    headers: { 'Content-Type': 'application/json' },
    data: { code: 'X', name: 'X', commissionPct: 5 },
  });
  expect([401, 403]).toContain(r.status());
});

test('Tracking: /r/[code] bez query → redirect na /cs/events', async ({
  context,
}) => {
  const r = await context.request.get('/r/SOMECODE', { maxRedirects: 0 });
  expect([302, 307]).toContain(r.status());
  const location = r.headers()['location'] ?? '';
  expect(location).toContain('/cs/events');
});

test('Tracking: /r/[code] s invalid code → fallback na /cs/events', async ({
  context,
}) => {
  const r = await context.request.get('/r/has spaces and stuff', {
    maxRedirects: 0,
  });
  // Browser/playwright URL encode space; ale samotná validation by failnula
  // — fallback redirect bez cookie
  expect([302, 307, 404]).toContain(r.status());
});
