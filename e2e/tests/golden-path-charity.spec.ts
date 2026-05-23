/**
 * Golden Path: Tickets for Good charity allocation (TIER 3 #9).
 *
 * Po P3.2 fix — žádné silent self-skip. Test dynamicky najde event
 * vlastněný promoter membership current usera, takže setup vždy projde.
 *
 * Flow:
 *   1. Promotér POST /api/admin/charity/allocations → allocation + N slots
 *   2. Promotér GET slot URLs
 *   3. Public GET preview
 *   4. Public POST claim → 200 + orderId
 *   5. KRITICKÝ — verify tickets.tickets row vznikl
 *   6. Re-claim → 410 ALREADY_RESOLVED
 *   7. Validace: invalid token, no auth, quantity bounds
 */
import { test, expect, type BrowserContext } from '@playwright/test';
import { Pool } from 'pg';

const ADMIN_EMAIL = 'admin@tixly.cz';
const CHARITY_ID = '00000000-0000-4000-c000-000000000001';

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

// Najdi event vlastněný promoter membership admin@tixly.cz (Demo Promoter).
// Tohle bylo dříve hardcoded na seed event 401, kterého admin@tixly.cz NEBYL
// promotérem → silent skip. Teď ho najdeme přes admin events endpoint.
async function findOwnedEvent(
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

test.describe.serial('Charity Tickets for Good', () => {
  const pool = new Pool({
    connectionString:
      process.env.DATABASE_URL ?? 'postgresql://tixly:tixly_dev@localhost:5433/tixly',
  });

  test.beforeAll(async () => {
    // Ensure Linka bezpečí charity exists + approved
    await pool.query(
      `INSERT INTO charity.partners (id, name, ico, contact_email, approved, approved_at)
       VALUES ($1, 'Linka bezpečí', '61383198', 'kontakt@linkabezpeci.cz', true, NOW())
       ON CONFLICT (ico) DO UPDATE SET approved = true, approved_at = NOW()`,
      [CHARITY_ID],
    );
  });

  test.afterAll(async () => {
    await pool.end();
  });

  test('full lifecycle — allocate → list slots → claim → ticket vystaven', async ({
    context,
  }) => {
    const admin = await login(context, ADMIN_EMAIL);
    const eventId = await findOwnedEvent(context, admin);

    // 1. Create allocation
    const create = await context.request.post('/api/admin/charity/allocations', {
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${admin.accessToken}`,
      },
      data: {
        charityId: CHARITY_ID,
        eventId,
        quantity: 2,
        taxWriteOffValueHalire: 60_000,
        message: 'Lístky pro děti z Linky bezpečí.',
      },
    });
    expect(create.status()).toBe(201);
    const created = (await create.json()) as {
      allocationId: string;
      slotsCreated: number;
    };
    expect(created.slotsCreated).toBe(2);

    // 2. Promotér získá slot URLs
    const slotsRes = await context.request.get(
      `/api/admin/charity/allocations/${created.allocationId}/slots`,
      { headers: { Authorization: `Bearer ${admin.accessToken}` } },
    );
    expect(slotsRes.status()).toBe(200);
    const slotsBody = (await slotsRes.json()) as {
      slots: Array<{ status: string; claimUrl: string }>;
    };
    expect(slotsBody.slots.length).toBe(2);
    expect(slotsBody.slots.every((s) => s.status === 'available')).toBe(true);

    const firstUrl = slotsBody.slots[0].claimUrl;
    const token = /\/charity\/claim\/([A-Za-z0-9_-]+)$/.exec(firstUrl)![1];

    // 3. Public preview
    const preview = await context.request.get(`/api/charity/claim/${token}`);
    expect(preview.status()).toBe(200);
    const previewBody = (await preview.json()) as {
      status: string;
      expired: boolean;
      event: { id: string };
      charityName: string;
    };
    expect(previewBody.status).toBe('available');
    expect(previewBody.expired).toBe(false);
    expect(previewBody.event.id).toBe(eventId);
    expect(previewBody.charityName).toBe('Linka bezpečí');

    // 4. Public POST claim
    const claimEmail = `charity-${Date.now()}@example.cz`;
    const claim = await context.request.post(`/api/charity/claim/${token}`, {
      headers: { 'Content-Type': 'application/json' },
      data: { email: claimEmail, name: 'Test Beneficiary' },
    });
    expect(claim.status()).toBe(200);
    const claimBody = (await claim.json()) as { ok: boolean; orderId: string };
    expect(claimBody.ok).toBe(true);
    expect(claimBody.orderId).toBeTruthy();

    // 5. KRITICKÝ — ověř že order existuje + ticket byl vystaven
    // (předtím test ověřoval jen response, ne DB side-effect — issueTicketsForOrder
    // je fire-and-forget `void`, mohl tiše selhat).
    // Vystavení je async, dáme krátký retry loop.
    let ticketRow:
      | { id: string; order_id: string; owner_id: string }
      | undefined;
    for (let i = 0; i < 10; i++) {
      const dbCheck = await pool.query<{
        id: string;
        order_id: string;
        owner_id: string;
      }>(
        `SELECT id::text, order_id::text, owner_id::text
           FROM tickets.tickets WHERE order_id = $1 LIMIT 1`,
        [claimBody.orderId],
      );
      if (dbCheck.rows.length > 0) {
        ticketRow = dbCheck.rows[0];
        break;
      }
      await new Promise((r) => setTimeout(r, 500));
    }
    expect(ticketRow, 'tickets.tickets row vytvořen po charity claim').toBeDefined();

    // 6. Ověř order_status=paid + total_amount=0
    const orderCheck = await pool.query<{ status: string; total_amount: number }>(
      `SELECT status, total_amount FROM orders.orders WHERE id = $1`,
      [claimBody.orderId],
    );
    expect(orderCheck.rows[0].status).toBe('paid');
    expect(orderCheck.rows[0].total_amount).toBe(0);

    // 7. Re-claim → 410
    const reClaim = await context.request.post(`/api/charity/claim/${token}`, {
      headers: { 'Content-Type': 'application/json' },
      data: { email: claimEmail },
    });
    expect(reClaim.status()).toBe(410);
    const reBody = (await reClaim.json()) as { error: string };
    expect(reBody.error).toBe('ALREADY_RESOLVED');
  });

  test('invalid token → 400', async ({ context }) => {
    const r = await context.request.get('/api/charity/claim/short');
    expect(r.status()).toBe(400);
  });

  test('nonexistent token → 404', async ({ context }) => {
    const r = await context.request.get(
      '/api/charity/claim/totally-bogus-token-12345-abcdefghij',
    );
    expect(r.status()).toBe(404);
  });

  test('allocate: bez auth → 401', async ({ playwright }) => {
    // Použijeme fresh API request context bez cookies (jiný browser session
    // se accessToken cookie z předchozího login by se přenášela).
    const fresh = await playwright.request.newContext({
      baseURL: 'http://localhost:3000',
    });
    const r = await fresh.post('/api/admin/charity/allocations', {
      headers: { 'Content-Type': 'application/json' },
      data: {
        charityId: CHARITY_ID,
        eventId: '00000000-0000-0000-0000-000000000001',
        quantity: 1,
      },
    });
    expect([401, 403]).toContain(r.status());
    await fresh.dispose();
  });

  test('allocate: invalid charity → 422 CHARITY_NOT_APPROVED', async ({
    context,
  }) => {
    const admin = await login(context, ADMIN_EMAIL);
    const eventId = await findOwnedEvent(context, admin);
    const r = await context.request.post('/api/admin/charity/allocations', {
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${admin.accessToken}`,
      },
      data: {
        charityId: '00000000-0000-0000-0000-000000000999',
        eventId,
        quantity: 1,
      },
    });
    expect(r.status()).toBe(422);
    const body = (await r.json()) as { error: string };
    expect(body.error).toBe('CHARITY_NOT_APPROVED');
  });

  test('allocate: quantity > 500 → 422', async ({ context }) => {
    const admin = await login(context, ADMIN_EMAIL);
    const eventId = await findOwnedEvent(context, admin);
    const r = await context.request.post('/api/admin/charity/allocations', {
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${admin.accessToken}`,
      },
      data: { charityId: CHARITY_ID, eventId, quantity: 1000 },
    });
    expect(r.status()).toBe(422);
  });

  test('claim UI: page renderuje preview', async ({ page, context }) => {
    const admin = await login(context, ADMIN_EMAIL);
    const eventId = await findOwnedEvent(context, admin);
    const create = await context.request.post('/api/admin/charity/allocations', {
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${admin.accessToken}`,
      },
      data: {
        charityId: CHARITY_ID,
        eventId,
        quantity: 1,
        message: 'UI smoke message',
      },
    });
    expect(create.status()).toBe(201);
    const { allocationId } = (await create.json()) as { allocationId: string };
    const slots = await context.request.get(
      `/api/admin/charity/allocations/${allocationId}/slots`,
      { headers: { Authorization: `Bearer ${admin.accessToken}` } },
    );
    const slotsBody = (await slots.json()) as {
      slots: Array<{ claimUrl: string }>;
    };
    const token = /\/charity\/claim\/([A-Za-z0-9_-]+)$/.exec(
      slotsBody.slots[0].claimUrl,
    )![1];

    await page.goto(`/cs/charity/claim/${token}`);
    await page.waitForLoadState('domcontentloaded');
    await expect(page.getByText(/Vstupenka od Linka bezpečí/)).toBeVisible({
      timeout: 10_000,
    });
    await expect(page.getByText(/UI smoke message/)).toBeVisible();
    await expect(page.getByText(/Vyzvednout vstupenku/)).toBeVisible();
  });
});
