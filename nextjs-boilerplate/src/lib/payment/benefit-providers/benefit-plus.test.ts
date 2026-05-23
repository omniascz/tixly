import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createHmac } from 'crypto';
import {
  createBenefitPlusPayment,
  verifyBenefitPlusCallback,
} from './benefit-plus';

const SECRET = 'bp-secret';

function expectedSignature(fields: Record<string, string | number>): string {
  const keys = Object.keys(fields).sort();
  const payload = keys.map((k) => `${k}=${fields[k]}`).join('&');
  return createHmac('sha256', SECRET).update(payload).digest('hex');
}

describe('createBenefitPlusPayment', () => {
  const originalEnv = process.env;
  beforeEach(() => {
    process.env = {
      ...originalEnv,
      BENEFIT_PLUS_PARTNER_ID: 'TIXLY-001',
      BENEFIT_PLUS_SECRET: SECRET,
      BENEFIT_PLUS_API_BASE_URL: 'https://api.test.bp.cz',
    };
  });
  afterEach(() => {
    process.env = originalEnv;
    vi.restoreAllMocks();
  });

  it('signuje body fields alphabetically + posílá s signature field', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          paymentId: 'p-1',
          payUrl: 'https://bp.cz/pay/p-1',
          expiresAt: new Date().toISOString(),
          signature: 'mock',
        }),
        { status: 200 },
      ),
    );

    const result = await createBenefitPlusPayment(
      {
        orderId: 'o',
        amountHalire: 50_000,
        buyerEmail: 'buyer@example.cz',
        provider: 'benefit_plus',
        appUrl: 'http://localhost:3000',
      },
      'ext-uuid-2',
    );

    expect(result.redirectUrl).toBe('https://bp.cz/pay/p-1');
    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    const body = JSON.parse(init.body as string) as Record<string, unknown>;
    expect(body.partnerId).toBe('TIXLY-001');
    expect(body.externalRef).toBe('ext-uuid-2');
    expect(body.amount).toBe(50_000);
    expect(body.signature).toBe(
      expectedSignature({
        partnerId: 'TIXLY-001',
        externalRef: 'ext-uuid-2',
        amount: 50_000,
        currency: 'CZK',
        email: 'buyer@example.cz',
      }),
    );
  });

  it('hodí když vendor 5xx', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      new Response('upstream timeout', { status: 502 }),
    );
    await expect(
      createBenefitPlusPayment(
        {
          orderId: 'o',
          amountHalire: 100,
          buyerEmail: 'b@e.cz',
          provider: 'benefit_plus',
          appUrl: 'http://localhost:3000',
        },
        'ext-1',
      ),
    ).rejects.toThrow(/Benefit Plus init failed: 502/);
  });
});

describe('verifyBenefitPlusCallback', () => {
  const originalEnv = process.env;
  beforeEach(() => {
    process.env = { ...originalEnv, BENEFIT_PLUS_SECRET: SECRET };
  });
  afterEach(() => {
    process.env = originalEnv;
  });

  it('returns true když signature matchne re-signed fields', () => {
    const fields = {
      paymentId: 'p-1',
      status: 'paid',
      amount: 50_000,
    };
    const sig = expectedSignature(fields);
    expect(verifyBenefitPlusCallback({ ...fields, signature: sig })).toBe(true);
  });

  it('returns false pro tampered amount', () => {
    const fields = { paymentId: 'p-1', status: 'paid', amount: 50_000 };
    const sig = expectedSignature(fields);
    expect(
      verifyBenefitPlusCallback({ ...fields, amount: 99999, signature: sig }),
    ).toBe(false);
  });

  it('returns false pokud chybí signature', () => {
    expect(verifyBenefitPlusCallback({ paymentId: 'p' })).toBe(false);
  });
});
