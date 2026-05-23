import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createHmac } from 'crypto';
import {
  createGalleryBetaPayment,
  verifyGalleryBetaCallback,
} from './gallery-beta';

describe('createGalleryBetaPayment', () => {
  const originalEnv = process.env;
  beforeEach(() => {
    process.env = {
      ...originalEnv,
      GALLERY_BETA_API_KEY: 'gb-key',
      GALLERY_BETA_API_BASE_URL: 'https://test.gallerybeta.cz',
    };
  });
  afterEach(() => {
    process.env = originalEnv;
    vi.restoreAllMocks();
  });

  it('POSTuje s Bearer auth a webhookUrl', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          paymentId: 'gb-1',
          redirectUrl: 'https://test.gallerybeta.cz/pay/gb-1',
        }),
        { status: 200 },
      ),
    );

    const result = await createGalleryBetaPayment(
      {
        orderId: 'o',
        amountHalire: 12_000,
        buyerEmail: 'b@e.cz',
        provider: 'gallery_beta',
        appUrl: 'http://localhost:3000',
      },
      'ext-gb',
    );

    expect(result.redirectUrl).toBe('https://test.gallerybeta.cz/pay/gb-1');
    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    const headers = init.headers as Record<string, string>;
    expect(headers.Authorization).toBe('Bearer gb-key');
    expect(headers['Idempotency-Key']).toBe('ext-gb');
    const body = JSON.parse(init.body as string);
    expect(body.webhookUrl).toContain('provider=gallery_beta');
  });
});

describe('verifyGalleryBetaCallback', () => {
  const SECRET = 'gb-cb';
  const originalEnv = process.env;
  beforeEach(() => {
    process.env = { ...originalEnv, GALLERY_BETA_CALLBACK_SECRET: SECRET };
  });
  afterEach(() => {
    process.env = originalEnv;
  });

  it('valid HMAC → true', () => {
    const body = '{"x":1}';
    const sig = createHmac('sha256', SECRET).update(body).digest('hex');
    expect(verifyGalleryBetaCallback(body, sig)).toBe(true);
  });
});
