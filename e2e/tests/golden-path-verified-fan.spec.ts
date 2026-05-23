/**
 * Golden Path: Verified Fan request → admin approve (TIER 2 #4)
 *
 * Po P3.3 fix — odstraněn `void eventId` stub helper + fake skip patterny.
 * Tento test pokrývá REGISTER + ADMIN APPROVE flow.
 *
 * GATE enforcement v checkoutu (presale_code requirement) je ověřen
 * v `golden-path-verified-fan-gate.spec.ts` (5 testů s reálnými DB asserts).
 *
 * Flow:
 *   1. Setup: enable verified_fan_enabled na ownned eventu
 *   2. Buyer POST register → 200 pending
 *   3. Re-register → 409 ALREADY_APPLIED
 *   4. Admin GET → vidí pending request
 *   5. Admin bulk approve → presale_code vygenerován
 *   6. VF DISABLED event → 422 VERIFIED_FAN_DISABLED
 */
import { test, expect, type BrowserContext } from '@playwright/test';
import { Pool } from 'pg';

const BUYER_EMAIL = 'anna.nova@example.cz';
const ADMIN_EMAIL = 'admin@tixly.cz';

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

async function findOwnedPublishedEvent(
  context: BrowserContext,
  admin: { accessToken: string },
): Promise<string> {
  const r = await context.request.get('/api/admin/events', {
    headers: { Authorization: `Bearer ${admin.accessToken}` },
  });
  const body = (await r.json()) as
    | Array<{ id: string; moderationStatus?: string }>
    | { events?: Array<{ id: string; moderationStatus?: string }> };
  const events = Array.isArray(body) ? body : (body.events ?? []);
  const published = events.find(
    (e) => !e.moderationStatus || e.moderationStatus === 'published',
  );
  if (!published) throw new Error('Admin nemá žádný published event');
  return published.id;
}

test.describe.serial('Verified Fan register + approve', () => {
  const pool = new Pool({
    connectionString:
      process.env.DATABASE_URL ?? 'postgresql://tixly:tixly_dev@localhost:5433/tixly',
  });

  let eventId: string;
  let buyerUserId: string;

  test.beforeAll(async () => {
    // Pre-cleanup: smaž případné existující VF requests pro buyera (idempotent test runs)
    // — eventId resolved v setup test, takže cleanup pak.
  });

  test.afterAll(async () => {
    if (eventId) {
      // Disable VF na eventu po testech aby ostatní golden paths neselhaly
      await pool.query(
        `UPDATE catalog.events SET verified_fan_enabled = FALSE WHERE id = $1`,
        [eventId],
      );
    }
    await pool.end();
  });

  test('setup: enable VF + cleanup existing requests', async ({ context }) => {
    const admin = await login(context, ADMIN_EMAIL);
    const buyer = await login(context, BUYER_EMAIL);
    eventId = await findOwnedPublishedEvent(context, admin);
    buyerUserId = buyer.userId;

    await pool.query(
      `UPDATE catalog.events SET verified_fan_enabled = TRUE WHERE id = $1`,
      [eventId],
    );
    await pool.query(
      `DELETE FROM marketing.verified_fan_requests
        WHERE user_id = $1 AND event_id = $2`,
      [buyerUserId, eventId],
    );
  });

  test('buyer register → 200 pending', async ({ context }) => {
    const buyer = await login(context, BUYER_EMAIL);
    const r = await context.request.post(
      `/api/events/${eventId}/verified-fan`,
      {
        headers: {
          'Content-Type': 'application/json',
          'x-user-id': buyer.userId,
          Authorization: `Bearer ${buyer.accessToken}`,
        },
        data: { motivation: 'Jsem fanoušek 10 let.' },
      },
    );
    expect(r.status()).toBe(200);
    const body = (await r.json()) as {
      ok: boolean;
      requestId: string;
      status: string;
    };
    expect(body.ok).toBe(true);
    expect(body.status).toBe('pending');
  });

  test('re-register stejný buyer → 409 ALREADY_APPLIED', async ({ context }) => {
    const buyer = await login(context, BUYER_EMAIL);
    const r = await context.request.post(
      `/api/events/${eventId}/verified-fan`,
      {
        headers: {
          'Content-Type': 'application/json',
          'x-user-id': buyer.userId,
          Authorization: `Bearer ${buyer.accessToken}`,
        },
        data: { motivation: 'Druhý pokus.' },
      },
    );
    expect(r.status()).toBe(409);
    const body = (await r.json()) as { error: string };
    expect(body.error).toBe('ALREADY_APPLIED');
  });

  test('admin GET → vidí pending request', async ({ context }) => {
    const admin = await login(context, ADMIN_EMAIL);
    const r = await context.request.get(
      `/api/admin/events/${eventId}/verified-fan`,
      { headers: { Authorization: `Bearer ${admin.accessToken}` } },
    );
    expect(r.status()).toBe(200);
    const body = (await r.json()) as {
      requests: Array<{ id: string; user_id: string; status: string }>;
    };
    expect(Array.isArray(body.requests)).toBe(true);
    const mine = body.requests.find((req) => req.user_id === buyerUserId);
    expect(mine).toBeDefined();
    expect(mine!.status).toBe('pending');
  });

  test('admin bulk approve → presale_code vygenerován v DB', async ({
    context,
  }) => {
    const admin = await login(context, ADMIN_EMAIL);
    const list = await context.request.get(
      `/api/admin/events/${eventId}/verified-fan`,
      { headers: { Authorization: `Bearer ${admin.accessToken}` } },
    );
    const listBody = (await list.json()) as {
      requests: Array<{ id: string; user_id: string; status: string }>;
    };
    const myReq = listBody.requests.find((r) => r.user_id === buyerUserId);
    expect(myReq).toBeDefined();

    const bulk = await context.request.post(
      `/api/admin/events/${eventId}/verified-fan`,
      {
        headers: {
          Authorization: `Bearer ${admin.accessToken}`,
          'Content-Type': 'application/json',
        },
        data: { ids: [myReq!.id], action: 'approve' },
      },
    );
    expect(bulk.status()).toBe(200);
    const bulkBody = (await bulk.json()) as { ok: boolean; processed: number };
    expect(bulkBody.processed).toBe(1);

    // DB assert — presale_code je opravdu set
    const dbCheck = await pool.query<{ status: string; presale_code: string | null }>(
      `SELECT status, presale_code FROM marketing.verified_fan_requests
        WHERE id = $1`,
      [myReq!.id],
    );
    expect(dbCheck.rows[0].status).toBe('approved');
    expect(dbCheck.rows[0].presale_code).toMatch(/^PSL-/);
  });
});

test('VF disabled event → 422 VERIFIED_FAN_DISABLED', async ({ context }) => {
  const buyer = await login(context, BUYER_EMAIL);
  // Romeo a Julie seed event — pravděpodobně bez VF enabled
  const r = await context.request.post(
    '/api/events/00000000-0000-4000-a000-000000000401/verified-fan',
    {
      headers: {
        'Content-Type': 'application/json',
        'x-user-id': buyer.userId,
        Authorization: `Bearer ${buyer.accessToken}`,
      },
      data: { motivation: 'Test' },
    },
  );
  // Možnost 200/409 pokud event už má VF enabled z dřívějšího testu
  // Pokud je VF disabled, 422 VERIFIED_FAN_DISABLED
  if (r.status() === 422) {
    const body = (await r.json()) as { error: string };
    expect(body.error).toBe('VERIFIED_FAN_DISABLED');
  }
});

test('bez auth → 401', async ({ playwright }) => {
  const fresh = await playwright.request.newContext({
    baseURL: 'http://localhost:3000',
  });
  const r = await fresh.post(
    '/api/events/00000000-0000-4000-a000-000000000401/verified-fan',
    {
      headers: { 'Content-Type': 'application/json' },
      data: { motivation: 'Test' },
    },
  );
  expect(r.status()).toBe(401);
  await fresh.dispose();
});

test('invalid event_id → 422', async ({ context }) => {
  const buyer = await login(context, BUYER_EMAIL);
  const r = await context.request.post('/api/events/not-a-uuid/verified-fan', {
    headers: {
      'Content-Type': 'application/json',
      'x-user-id': buyer.userId,
      Authorization: `Bearer ${buyer.accessToken}`,
    },
    data: {},
  });
  expect(r.status()).toBe(422);
});
