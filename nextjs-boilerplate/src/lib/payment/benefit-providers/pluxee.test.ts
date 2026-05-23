import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createHmac } from 'crypto';
import { createPluxeePayment, verifyPluxeeCallback } from './pluxee';

describe('createPluxeePayment', () => {
  const originalEnv = process.env;
  beforeEach(() => {
    process.env = {
      ...originalEnv,
      PLUXEE_MERCHANT_ID: 'M-TIXLY',
      PLUXEE_API_KEY: 'sk_test_abc',
      PLUXEE_API_BASE_URL: 'https://api.test.pluxee.cz',
    };
    vi.restoreAllMocks();
  });
  afterEach(() => {
    process.env = originalEnv;
    vi.restoreAllMocks();
  });

  it('POSTuje na vendor endpoint s correct headers + body', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          transactionId: 'tx-xyz',
          redirectUrl: 'https://api.test.pluxee.cz/portal/redirect/tx-xyz',
          status: 'redirected',
          expiresAt: new Date(Date.now() + 600000).toISOString(),
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      ),
    );

    const result = await createPluxeePayment(
      {
        orderId: 'order-1',
        amountHalire: 30000,
        buyerEmail: 'buyer@example.cz',
        provider: 'pluxee',
        appUrl: 'http://localhost:3000',
      },
      'ext-uuid-1',
    );

    expect(result.redirectUrl).toContain('portal/redirect/tx-xyz');
    expect(fetchMock).toHaveBeenCalledOnce();
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://api.test.pluxee.cz/v1/transactional/create');
    expect(init.method).toBe('POST');
    const headers = init.headers as Record<string, string>;
    expect(headers.Authorization).toBe('Bearer sk_test_abc');
    expect(headers['X-Merchant-Id']).toBe('M-TIXLY');
    expect(headers['Idempotency-Key']).toBe('ext-uuid-1');
    const body = JSON.parse(init.body as string);
    expect(body.merchantTransactionId).toBe('ext-uuid-1');
    expect(body.amountMinor).toBe(30000);
    expect(body.currency).toBe('CZK');
    expect(body.callbackUrl).toContain('/api/payments/benefit/callback');
    expect(body.callbackUrl).toContain('provider=pluxee');
  });

  it('hodí pokud vendor vrátí non-2xx', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      new Response('Bad request', { status: 400 }),
    );

    await expect(
      createPluxeePayment(
        {
          orderId: 'o',
          amountHalire: 100,
          buyerEmail: 'b@e.cz',
          provider: 'pluxee',
          appUrl: 'http://localhost:3000',
        },
        'ext-1',
      ),
    ).rejects.toThrow(/Pluxee create failed: 400/);
  });

  it('hodí pokud response chybí redirectUrl', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      new Response(JSON.stringify({ transactionId: 'x' }), { status: 200 }),
    );

    await expect(
      createPluxeePayment(
        {
          orderId: 'o',
          amountHalire: 100,
          buyerEmail: 'b@e.cz',
          provider: 'pluxee',
          appUrl: 'http://localhost:3000',
        },
        'ext-1',
      ),
    ).rejects.toThrow(/missing redirectUrl/);
  });

  it('hodí pokud chybí PLUXEE_MERCHANT_ID', async () => {
    delete process.env.PLUXEE_MERCHANT_ID;
    await expect(
      createPluxeePayment(
        {
          orderId: 'o',
          amountHalire: 100,
          buyerEmail: 'b@e.cz',
          provider: 'pluxee',
          appUrl: 'http://localhost:3000',
        },
        'ext-1',
      ),
    ).rejects.toThrow(/required/);
  });
});

describe('verifyPluxeeCallback', () => {
  const SECRET = 'pluxee-test-secret';
  const originalEnv = process.env;
  beforeEach(() => {
    process.env = { ...originalEnv, PLUXEE_CALLBACK_SECRET: SECRET };
  });
  afterEach(() => {
    process.env = originalEnv;
  });

  it('returns true pro valid signature', () => {
    const body = '{"status":"paid","amountMinor":30000}';
    const sig = createHmac('sha256', SECRET).update(body).digest('hex');
    expect(verifyPluxeeCallback(body, sig)).toBe(true);
  });

  it('returns true s sha256= prefix', () => {
    const body = '{"x":1}';
    const sig =
      'sha256=' + createHmac('sha256', SECRET).update(body).digest('hex');
    expect(verifyPluxeeCallback(body, sig)).toBe(true);
  });

  it('returns false pro invalid signature', () => {
    expect(verifyPluxeeCallback('{"x":1}', 'a'.repeat(64))).toBe(false);
  });

  it('returns false pokud chybí secret', () => {
    delete process.env.PLUXEE_CALLBACK_SECRET;
    expect(verifyPluxeeCallback('{"x":1}', 'sig')).toBe(false);
  });

  it('returns false pokud chybí header', () => {
    expect(verifyPluxeeCallback('{"x":1}', null)).toBe(false);
  });
});
