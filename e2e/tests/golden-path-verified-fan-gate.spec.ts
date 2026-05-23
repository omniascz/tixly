/**
 * Golden Path: Verified Fan presale_code GATE v checkoutu (P1.5 fix).
 *
 * Předchozí golden-path-verified-fan.spec.ts ověřoval register → approve,
 * ale NEOVĚŘOVAL že code skutečně funguje jako gate. Bez tohoto testu
 * byl celý VF flow shell — code se vygeneroval ale checkout ho ignoroval.
 *
 * Tento test:
 *  1. Vytvoří DB-side VF-enabled event s approved request + presale_code
 *  2. Volá /api/checkout BEZ presaleCode → 422 VERIFIED_FAN_REQUIRED
 *  3. Volá s INVALID code → 422 PRESALE_CODE_INVALID
 *  4. Volá s VALID code → 200 + marking used_order_id v DB
 *  5. Re-use stejný code → 422 PRESALE_CODE_INVALID
 */
import { test, expect, type BrowserContext } from '@playwright/test';
import { Pool } from 'pg';

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
  throw new Error('No usable GA event with availability');
}

test.describe.serial('Verified Fan gate', () => {
  const pool = new Pool({
    connectionString:
      process.env.DATABASE_URL ?? 'postgresql://tixly:tixly_dev@localhost:5433/tixly',
  });

  let eventId: string;
  let ticketTypeId: string;
  let presaleCode: string;
  let userId: string;

  test.afterAll(async () => {
    // Cleanup — disable VF na eventu aby ostatní testy nepadaly
    if (eventId) {
      await pool.query(
        `UPDATE catalog.events SET verified_fan_enabled = FALSE WHERE id = $1`,
        [eventId],
      );
    }
    await pool.end();
  });

  test('setup: enable VF na eventu + create approved presale_code', async ({
    context,
  }) => {
    const admin = await login(context, ADMIN_EMAIL);
    userId = admin.userId;
    const e = await getUsableEvent(context, admin);
    eventId = e.eventId;
    ticketTypeId = e.ticketTypeId;

    // Enable VF na eventu
    await pool.query(
      `UPDATE catalog.events SET verified_fan_enabled = TRUE WHERE id = $1`,
      [eventId],
    );

    // Vytvoř approved VF request s unikátním presale_code
    presaleCode = `PSL-VFT-${Date.now().toString().slice(-8)}`;
    await pool.query(
      `INSERT INTO marketing.verified_fan_requests
         (user_id, event_id, status, presale_code, approved_at)
       VALUES ($1, $2, 'approved', $3, NOW())
       ON CONFLICT (user_id, event_id) DO UPDATE
         SET status = 'approved', presale_code = $3, approved_at = NOW(),
             used_order_id = NULL, used_at = NULL`,
      [userId, eventId, presaleCode],
    );
  });

  test('bez presaleCode → 422 VERIFIED_FAN_REQUIRED', async ({ context }) => {
    const admin = await login(context, ADMIN_EMAIL);
    const r = await context.request.post('/api/checkout', {
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${admin.accessToken}`,
      },
      data: {
        eventId,
        ticketTypeId,
        quantity: 1,
        buyerEmail: `vf-${Date.now()}@example.cz`,
        buyerName: 'VF Test',
        paymentMethod: 'gopay',
      },
    });
    expect(r.status()).toBe(422);
    const body = (await r.json()) as { error: string };
    expect(body.error).toBe('VERIFIED_FAN_REQUIRED');
  });

  test('invalid code → 422 PRESALE_CODE_INVALID', async ({ context }) => {
    const admin = await login(context, ADMIN_EMAIL);
    const r = await context.request.post('/api/checkout', {
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${admin.accessToken}`,
      },
      data: {
        eventId,
        ticketTypeId,
        quantity: 1,
        buyerEmail: `vf-bad-${Date.now()}@example.cz`,
        buyerName: 'VF Test',
        paymentMethod: 'gopay',
        presaleCode: 'PSL-NOPE-99999',
      },
    });
    expect(r.status()).toBe(422);
    const body = (await r.json()) as { error: string };
    expect(body.error).toBe('PRESALE_CODE_INVALID');
  });

  test('valid code → 200 + used_order_id v DB', async ({ context }) => {
    const admin = await login(context, ADMIN_EMAIL);
    const r = await context.request.post('/api/checkout', {
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${admin.accessToken}`,
      },
      data: {
        eventId,
        ticketTypeId,
        quantity: 1,
        buyerEmail: `vf-ok-${Date.now()}@example.cz`,
        buyerName: 'VF Test',
        paymentMethod: 'gopay',
        presaleCode,
      },
    });
    const bodyDebug = await r.json();
    if (r.status() !== 200) {
      console.error('Checkout failed:', r.status(), JSON.stringify(bodyDebug));
    }
    expect(r.status()).toBe(200);
    const body = bodyDebug as { orderId: string };
    expect(body.orderId).toBeTruthy();

    // Verify DB side-effect — code byl označen jako použitý
    const check = await pool.query<{
      status: string;
      used_order_id: string | null;
    }>(
      `SELECT status, used_order_id::text FROM marketing.verified_fan_requests
        WHERE presale_code = $1`,
      [presaleCode],
    );
    expect(check.rows[0].status).toBe('used');
    expect(check.rows[0].used_order_id).toBe(body.orderId);
  });

  test('re-use stejného code → 422 PRESALE_CODE_INVALID', async ({ context }) => {
    const admin = await login(context, ADMIN_EMAIL);
    const r = await context.request.post('/api/checkout', {
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${admin.accessToken}`,
      },
      data: {
        eventId,
        ticketTypeId,
        quantity: 1,
        buyerEmail: `vf-reuse-${Date.now()}@example.cz`,
        buyerName: 'VF Test',
        paymentMethod: 'gopay',
        presaleCode,
      },
    });
    expect(r.status()).toBe(422);
    const body = (await r.json()) as { error: string };
    expect(body.error).toBe('PRESALE_CODE_INVALID');
  });
});
