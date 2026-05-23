import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createDppPass } from './dpp';

describe('createDppPass', () => {
  const originalEnv = process.env;
  beforeEach(() => {
    process.env = {
      ...originalEnv,
      DPP_API_KEY: 'dpp-test-key',
      DPP_API_BASE_URL: 'https://test.dpp.cz',
      DPP_PARTNER_CODE: 'tixly-test',
    };
  });
  afterEach(() => {
    process.env = originalEnv;
    vi.restoreAllMocks();
  });

  it('POSTuje na /v1/passes s Bearer auth + Idempotency-Key', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          passId: 'p-123',
          qrPayload: 'tixly-mhd:dpp:order-1:abc',
          signature: 'abc',
          validFrom: new Date().toISOString(),
          validUntil: new Date(Date.now() + 86400000).toISOString(),
        }),
        { status: 200 },
      ),
    );

    const result = await createDppPass({
      orderId: 'order-1',
      partnerSlug: 'dpp',
      zones: ['P', '0', 'B'],
      validFrom: new Date('2026-06-01T18:00:00Z'),
      validUntil: new Date('2026-06-02T02:00:00Z'),
    });

    expect(result.qrPayload).toContain('tixly-mhd:dpp:order-1');
    expect(result.validationSignature).toBe('abc');

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://test.dpp.cz/v1/passes');
    expect(init.method).toBe('POST');
    const headers = init.headers as Record<string, string>;
    expect(headers.Authorization).toBe('Bearer dpp-test-key');
    expect(headers['Idempotency-Key']).toBe('order-1');
    const body = JSON.parse(init.body as string);
    expect(body.partner).toBe('tixly-test');
    expect(body.zones).toEqual(['P', '0', 'B']);
    expect(body.externalRef).toBe('order-1');
  });

  it('hodí pokud vendor non-2xx', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      new Response('Forbidden', { status: 403 }),
    );
    await expect(
      createDppPass({
        orderId: 'o',
        partnerSlug: 'dpp',
        zones: ['P'],
        validFrom: new Date(),
        validUntil: new Date(Date.now() + 3600000),
      }),
    ).rejects.toThrow(/DPP create pass failed: 403/);
  });

  it('hodí pokud response missing qrPayload', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      new Response(JSON.stringify({ passId: 'p', signature: 'x' }), { status: 200 }),
    );
    await expect(
      createDppPass({
        orderId: 'o',
        partnerSlug: 'dpp',
        zones: ['P'],
        validFrom: new Date(),
        validUntil: new Date(Date.now() + 3600000),
      }),
    ).rejects.toThrow(/missing qrPayload/);
  });

  it('hodí pokud chybí DPP_API_KEY', async () => {
    delete process.env.DPP_API_KEY;
    await expect(
      createDppPass({
        orderId: 'o',
        partnerSlug: 'dpp',
        zones: ['P'],
        validFrom: new Date(),
        validUntil: new Date(Date.now() + 3600000),
      }),
    ).rejects.toThrow(/DPP_API_KEY required/);
  });
});
