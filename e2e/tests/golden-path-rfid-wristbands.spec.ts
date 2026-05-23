/**
 * Golden Path: RFID cashless wristbands (TIER 3 #8).
 *
 * Po P3.1 fix — žádné silent-skip patterny. Test setup používá DB pro
 * pre-cleanup (smaže existující wristbands) aby každý run byl deterministický.
 *
 * Schema kontrola: tickets.wristbands + tickets.wristband_transactions
 * (vytvořené migrací 324).
 *
 * Flow:
 *   1. Setup: cleanup existing wristbands na test ticketech
 *   2. POST bind → 200 + balance
 *   3. GET → tx list + balance
 *   4. POST topup → balance + tx
 *   5. POST charge → balance + tx
 *   6. POST charge over → 409 INSUFFICIENT_BALANCE
 *   7. POST bind same UID different ticket → 409 UID_ALREADY_BOUND
 */
import { test, expect, type BrowserContext } from '@playwright/test';
import { Pool } from 'pg';

const ADMIN_EMAIL = 'admin@tixly.cz';
const RUN_ID = Date.now().toString().slice(-8);

// Známé seeded tickets pro Demo Promoter (admin@tixly.cz je member).
// Test si je rezervuje a po setup je čistý.
const TEST_TICKETS = [
  '2097d4f2-043b-4306-9565-0a48d5bce1cd',
  '5e41207b-8558-4eef-8332-136545050151',
  'ee407c93-4743-4c89-88a4-a51530785f3b',
  '3fed8f1d-5751-4971-a66d-cbb3a0d81e65',
  '9fa73e05-8dac-4f4b-92ff-96edeae7e53a',
];

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

test.describe.serial('RFID wristbands', () => {
  const pool = new Pool({
    connectionString:
      process.env.DATABASE_URL ?? 'postgresql://tixly:tixly_dev@localhost:5433/tixly',
  });

  test.beforeAll(async () => {
    // Cleanup test ticket wristbands — guarantee fresh state
    await pool.query(
      `DELETE FROM tickets.wristbands WHERE ticket_id = ANY($1::uuid[])`,
      [TEST_TICKETS],
    );
  });

  test.afterAll(async () => {
    // Post-cleanup — uvolnění pro další run
    await pool.query(
      `DELETE FROM tickets.wristbands WHERE ticket_id = ANY($1::uuid[])`,
      [TEST_TICKETS],
    );
    await pool.end();
  });

  test('bind → balance → topup → charge → insufficient', async ({ context }) => {
    const admin = await login(context, ADMIN_EMAIL);
    const ticketId = TEST_TICKETS[0];
    const uid = `WB-MAIN-${RUN_ID}`;

    // 1. Bind s initial top-up 100 Kč
    const bind = await context.request.post('/api/admin/wristbands/bind', {
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${admin.accessToken}`,
      },
      data: { ticketId, uid, initialTopupHalire: 10_000 },
    });
    expect(bind.status()).toBe(200);
    const bindBody = (await bind.json()) as {
      ok: boolean;
      uid: string;
      balanceHalire: number;
    };
    expect(bindBody.ok).toBe(true);
    expect(bindBody.uid).toBe(uid);
    expect(bindBody.balanceHalire).toBe(10_000);

    // 2. GET info + transactions
    const info = await context.request.get(`/api/admin/wristbands/${uid}`, {
      headers: { Authorization: `Bearer ${admin.accessToken}` },
    });
    expect(info.status()).toBe(200);
    const infoBody = (await info.json()) as {
      uid: string;
      balanceHalire: number;
      active: boolean;
      transactions: Array<{ kind: string; amountHalire: number; balanceAfter: number }>;
    };
    expect(infoBody.uid).toBe(uid);
    expect(infoBody.active).toBe(true);
    expect(infoBody.balanceHalire).toBe(10_000);
    expect(infoBody.transactions.some((t) => t.kind === 'topup')).toBe(true);

    // 3. Top-up další 50 Kč
    const topup = await context.request.post(
      `/api/admin/wristbands/${uid}/topup`,
      {
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${admin.accessToken}`,
        },
        data: { amountHalire: 5_000, paymentMethod: 'cash', description: 'Bar refill' },
      },
    );
    expect(topup.status()).toBe(200);
    const topupBody = (await topup.json()) as { balanceHalire: number };
    expect(topupBody.balanceHalire).toBe(15_000);

    // 4. Charge 60 Kč
    const charge = await context.request.post(
      `/api/admin/wristbands/${uid}/charge`,
      {
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${admin.accessToken}`,
        },
        data: { amountHalire: 6_000, vendorLabel: 'Bar 1', description: 'Pivo 0.5l' },
      },
    );
    expect(charge.status()).toBe(200);
    const chargeBody = (await charge.json()) as { balanceHalire: number };
    expect(chargeBody.balanceHalire).toBe(9_000);

    // 5. Charge over balance → 409 INSUFFICIENT_BALANCE
    const overcharge = await context.request.post(
      `/api/admin/wristbands/${uid}/charge`,
      {
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${admin.accessToken}`,
        },
        data: { amountHalire: 100_000_000, vendorLabel: 'Bar 99' },
      },
    );
    expect(overcharge.status()).toBe(409);
    const overBody = (await overcharge.json()) as {
      error: string;
      balanceHalire: number;
    };
    expect(overBody.error).toBe('INSUFFICIENT_BALANCE');
    expect(overBody.balanceHalire).toBe(9_000);

    // 6. Verify final state v DB
    const dbCheck = await pool.query<{ balance_halire: number; tx_count: string }>(
      `SELECT w.balance_halire,
              (SELECT COUNT(*)::text FROM tickets.wristband_transactions
                WHERE wristband_uid = w.uid) AS tx_count
         FROM tickets.wristbands w WHERE w.uid = $1`,
      [uid],
    );
    expect(dbCheck.rows[0].balance_halire).toBe(9_000);
    expect(Number(dbCheck.rows[0].tx_count)).toBe(3); // topup×2 + purchase
  });

  test('bind duplicate UID → 409 UID_ALREADY_BOUND', async ({ context }) => {
    const admin = await login(context, ADMIN_EMAIL);
    const dupUid = `WB-DUP-${RUN_ID}`;

    // First bind on TEST_TICKETS[1] (cleanup beforeAll smazal existing)
    const first = await context.request.post('/api/admin/wristbands/bind', {
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${admin.accessToken}`,
      },
      data: { ticketId: TEST_TICKETS[1], uid: dupUid },
    });
    expect(first.status()).toBe(200);

    // Second bind SAME UID different ticket → must 409
    const second = await context.request.post('/api/admin/wristbands/bind', {
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${admin.accessToken}`,
      },
      data: { ticketId: TEST_TICKETS[2], uid: dupUid },
    });
    expect(second.status()).toBe(409);
    const body = (await second.json()) as { error: string };
    expect(body.error).toBe('UID_ALREADY_BOUND');
  });

  test('invalid ticket → 404', async ({ context }) => {
    const admin = await login(context, ADMIN_EMAIL);
    const r = await context.request.post('/api/admin/wristbands/bind', {
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${admin.accessToken}`,
      },
      data: {
        ticketId: '00000000-0000-0000-0000-000000000999',
        uid: `WB-INV-${RUN_ID}`,
      },
    });
    expect(r.status()).toBe(404);
  });

  test('bez auth → 401', async ({ context }) => {
    const r = await context.request.post('/api/admin/wristbands/bind', {
      headers: { 'Content-Type': 'application/json' },
      data: { ticketId: TEST_TICKETS[0], uid: 'X' },
    });
    expect([401, 403]).toContain(r.status());
  });

  test('nonexistent UID GET → 404', async ({ context }) => {
    const admin = await login(context, ADMIN_EMAIL);
    const r = await context.request.get(
      '/api/admin/wristbands/totally-bogus-uid-zzz',
      { headers: { Authorization: `Bearer ${admin.accessToken}` } },
    );
    expect(r.status()).toBe(404);
  });
});
