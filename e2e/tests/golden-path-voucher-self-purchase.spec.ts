/**
 * Golden Path: Voucher self-service (DACH parity #P1-2, Reservix Gutschein pattern)
 *
 * Buyer si sám kupuje dárkový poukaz přes promoter landing page
 * `/cs/p/[slug]/vouchers`. Platnost 3 roky, kód uplatnitelný v checkoutu
 * jako partial payment (lookup endpoint už existuje).
 *
 * Flow:
 *   1) Promotér slug resolve (public)
 *   2) POST /api/p/[slug]/vouchers/checkout → mock-voucher gateway URL
 *   3) POST /api/vouchers/holders/[paymentId]/confirm → kód aktivován
 *   4) POST /api/buyer/vouchers/lookup → balance + expiry ověřen
 *   5) Idempotency: druhý confirm = "Already processed"
 *
 * Plus UI smoke: navigate landing page, vybrat 1000 Kč, vyplnit form,
 * klik Pokračovat → mock-voucher page s tlačítkem Zaplatit → ověř kód.
 */
import { test, expect, type BrowserContext } from '@playwright/test';

const PROMOTER_SLUG = 'divadlo-verze'; // existuje v demo DB (memory)
const BUYER_EMAIL = `voucher-test+${Date.now()}@example.cz`;
const BUYER_NAME = 'Voucher Buyer';

test('Voucher self-purchase: checkout → confirm → lookup vrátí balance', async ({
  context,
}) => {
  let paymentId = '';
  let voucherCode = '';
  let voucherId = '';
  const amountKc = 1500;

  await test.step('1. POST /api/p/[slug]/vouchers/checkout', async () => {
    const r = await context.request.post(
      `/api/p/${PROMOTER_SLUG}/vouchers/checkout`,
      {
        headers: { 'Content-Type': 'application/json' },
        data: {
          amountKc,
          buyerEmail: BUYER_EMAIL,
          buyerName: BUYER_NAME,
          recipientEmail: 'recipient@example.cz',
          recipientName: 'Recipient Name',
          message: 'Hodně štěstí!',
        },
      },
    );
    expect(r.status()).toBe(200);
    const body = (await r.json()) as {
      voucherId: string;
      voucherCode: string;
      amountHalire: number;
      expiresAt: string;
      gatewayUrl: string;
      paymentId: string;
    };
    expect(body.amountHalire).toBe(amountKc * 100);
    expect(body.voucherCode).toMatch(/^[A-Z0-9]{4}-[A-Z0-9]{4}-[A-Z0-9]{4}$/);
    expect(body.gatewayUrl).toBe(`/mock-voucher/${body.paymentId}`);
    // 3-year validity
    const expiry = new Date(body.expiresAt).getTime();
    const expected = Date.now() + 3 * 365 * 24 * 3600 * 1000;
    expect(Math.abs(expiry - expected)).toBeLessThan(2 * 24 * 3600 * 1000);
    paymentId = body.paymentId;
    voucherCode = body.voucherCode;
    voucherId = body.voucherId;
  });

  await test.step('2. Confirm payment (pay)', async () => {
    const r = await context.request.post(
      `/api/vouchers/holders/${paymentId}/confirm`,
      {
        headers: { 'Content-Type': 'application/json' },
        data: { action: 'pay' },
      },
    );
    expect(r.status()).toBe(200);
    const body = (await r.json()) as {
      paymentStatus: string;
      voucherCode: string;
      amountHalire: number;
    };
    expect(body.paymentStatus).toBe('paid');
    expect(body.voucherCode).toBe(voucherCode);
    expect(body.amountHalire).toBe(amountKc * 100);
  });

  await test.step('3. Lookup vrátí balance', async () => {
    const r = await context.request.post('/api/buyer/vouchers/lookup', {
      headers: { 'Content-Type': 'application/json' },
      data: { code: voucherCode },
    });
    expect(r.status()).toBe(200);
    const body = (await r.json()) as {
      balanceHalire: number;
      amountHalire: number;
      expiresAt: string;
    };
    expect(body.balanceHalire).toBe(amountKc * 100);
    expect(body.amountHalire).toBe(amountKc * 100);
  });

  await test.step('4. Idempotency: druhý confirm = Already processed', async () => {
    const r = await context.request.post(
      `/api/vouchers/holders/${paymentId}/confirm`,
      {
        headers: { 'Content-Type': 'application/json' },
        data: { action: 'pay' },
      },
    );
    expect(r.status()).toBe(200);
    const body = (await r.json()) as { message?: string };
    expect(body.message).toBe('Already processed');
  });

  expect(voucherId).toBeTruthy();
});

test('Voucher self-purchase: validation 99 Kč → 422 amount min', async ({
  context,
}) => {
  const r = await context.request.post(
    `/api/p/${PROMOTER_SLUG}/vouchers/checkout`,
    {
      headers: { 'Content-Type': 'application/json' },
      data: {
        amountKc: 99,
        buyerEmail: 'x@example.cz',
        buyerName: 'X',
      },
    },
  );
  expect(r.status()).toBe(422);
});

test('Voucher self-purchase: neexistující promoter → 404', async ({
  context,
}) => {
  const r = await context.request.post(
    '/api/p/totally-nonexistent-promoter-xyz/vouchers/checkout',
    {
      headers: { 'Content-Type': 'application/json' },
      data: {
        amountKc: 500,
        buyerEmail: 'x@example.cz',
        buyerName: 'X',
      },
    },
  );
  expect(r.status()).toBe(404);
});

test('Voucher self-purchase: cancel → balance=0', async ({ context }) => {
  const create = await context.request.post(
    `/api/p/${PROMOTER_SLUG}/vouchers/checkout`,
    {
      headers: { 'Content-Type': 'application/json' },
      data: {
        amountKc: 200,
        buyerEmail: `cancel+${Date.now()}@example.cz`,
        buyerName: 'Cancel Test',
      },
    },
  );
  const { paymentId, voucherCode } = (await create.json()) as {
    paymentId: string;
    voucherCode: string;
  };

  const cancel = await context.request.post(
    `/api/vouchers/holders/${paymentId}/confirm`,
    { data: { action: 'cancel' } },
  );
  expect(cancel.status()).toBe(200);

  // Lookup po cancel = DEPLETED (balance=0)
  const lookup = await context.request.post('/api/buyer/vouchers/lookup', {
    headers: { 'Content-Type': 'application/json' },
    data: { code: voucherCode },
  });
  expect(lookup.status()).toBe(410);
  const body = (await lookup.json()) as { error: string };
  expect(body.error).toBe('DEPLETED');
});

test('Voucher landing page UI: 1000 Kč quick amount + form + redirect', async ({
  page,
}) => {
  await page.goto(`/cs/p/${PROMOTER_SLUG}/vouchers`);
  await page.waitForLoadState('domcontentloaded');

  // Heading viditelný
  await expect(page.getByText('Dárkové poukazy')).toBeVisible();

  // Klik na 1000 Kč quick amount
  await page.getByTestId('voucher-amount-1000').click();

  // Vyplň povinné fieldy
  const uniqueEmail = `ui-voucher+${Date.now()}@example.cz`;
  await page.getByTestId('voucher-buyer-email').fill(uniqueEmail);
  await page.getByTestId('voucher-buyer-name').fill('UI Test Buyer');

  // Submit
  await page.getByTestId('voucher-submit').click();

  // Mock-voucher page se musí otevřít
  await expect(page).toHaveURL(/\/mock-voucher\/[0-9a-f-]+/);
  await expect(page.getByText('Mock platba')).toBeVisible();

  // Klik Zaplatit → kód musí být viditelný
  await page.getByTestId('voucher-pay').click();
  await expect(page.getByTestId('voucher-code')).toBeVisible({ timeout: 5000 });

  const code = await page.getByTestId('voucher-code').textContent();
  expect(code).toMatch(/^[A-Z0-9]{4}-[A-Z0-9]{4}-[A-Z0-9]{4}$/);
});
