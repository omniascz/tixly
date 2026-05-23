import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createHmac } from 'crypto';
import { createEdenredPayment, verifyEdenredCallback } from './edenred';

describe('createEdenredPayment', () => {
  const originalEnv = process.env;
  beforeEach(() => {
    process.env = {
      ...originalEnv,
      EDENRED_MERCHANT_ID: 'EDN-M-1',
      EDENRED_API_KEY: 'edn-key',
      EDENRED_API_BASE_URL: 'https://test.edenred.cz',
    };
  });
  afterEach(() => {
    process.env = originalEnv;
    vi.restoreAllMocks();
  });

  it('POSTuje na initialize endpoint s ApiKey auth', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          externalId: 'ext-1',
          redirectUrl: 'https://test.edenred.cz/portal/ext-1',
          status: 'redirected',
        }),
        { status: 200 },
      ),
    );

    const result = await createEdenredPayment(
      {
        orderId: 'o',
        amountHalire: 25_000,
        buyerEmail: 'b@e.cz',
        provider: 'edenred',
        appUrl: 'http://localhost:3000',
      },
      'ext-1',
    );

    expect(result.redirectUrl).toBe('https://test.edenred.cz/portal/ext-1');
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://test.edenred.cz/v2/payment/initialize');
    const headers = init.headers as Record<string, string>;
    expect(headers.Authorization).toBe('ApiKey edn-key');
    expect(headers['X-Merchant-Id']).toBe('EDN-M-1');
    const body = JSON.parse(init.body as string);
    expect(body.product).toBe('TICKET_SPORT_CULTURE');
  });

  it('hodí při missing creds', async () => {
    delete process.env.EDENRED_API_KEY;
    await expect(
      createEdenredPayment(
        {
          orderId: 'o',
          amountHalire: 100,
          buyerEmail: 'b@e.cz',
          provider: 'edenred',
          appUrl: 'http://localhost:3000',
        },
        'ext',
      ),
    ).rejects.toThrow(/required/);
  });
});

describe('verifyEdenredCallback', () => {
  const SECRET = 'edn-cb';
  const originalEnv = process.env;
  beforeEach(() => {
    process.env = { ...originalEnv, EDENRED_CALLBACK_SECRET: SECRET };
  });
  afterEach(() => {
    process.env = originalEnv;
  });

  it('valid HMAC → true', () => {
    const body = '{"status":"paid"}';
    const sig = createHmac('sha256', SECRET).update(body).digest('hex');
    expect(verifyEdenredCallback(body, sig)).toBe(true);
  });

  it('tampered body → false', () => {
    const sig = createHmac('sha256', SECRET).update('{"status":"paid"}').digest('hex');
    expect(verifyEdenredCallback('{"status":"failed"}', sig)).toBe(false);
  });
});
