import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createIdosBrnoPass } from './idos-brno';

describe('createIdosBrnoPass', () => {
  const originalEnv = process.env;
  beforeEach(() => {
    process.env = {
      ...originalEnv,
      IDOS_BRNO_API_KEY: 'kordis-key',
      IDOS_BRNO_API_BASE_URL: 'https://test.kordis-jmk.cz',
    };
  });
  afterEach(() => {
    process.env = originalEnv;
    vi.restoreAllMocks();
  });

  it('POSTuje na /v1/tickets/issue s X-API-Key', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          ticketId: 't-1',
          qrCode: 'kordis-qr-payload',
          hmac: 'abcd1234',
        }),
        { status: 200 },
      ),
    );

    const result = await createIdosBrnoPass({
      orderId: 'order-2',
      partnerSlug: 'idos-brno',
      zones: ['100', '101'],
      validFrom: new Date('2026-06-01T18:00:00Z'),
      validUntil: new Date('2026-06-02T02:00:00Z'),
    });

    expect(result.qrPayload).toBe('kordis-qr-payload');
    expect(result.validationSignature).toBe('abcd1234');

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://test.kordis-jmk.cz/v1/tickets/issue');
    const headers = init.headers as Record<string, string>;
    expect(headers['X-API-Key']).toBe('kordis-key');
    expect(headers['X-Idempotency-Key']).toBe('order-2');
    const body = JSON.parse(init.body as string);
    expect(body.zones).toEqual(['100', '101']);
    expect(body.product).toBe('EVENT_COMBO');
  });

  it('hodí pri missing creds', async () => {
    delete process.env.IDOS_BRNO_API_KEY;
    await expect(
      createIdosBrnoPass({
        orderId: 'o',
        partnerSlug: 'idos-brno',
        zones: ['100'],
        validFrom: new Date(),
        validUntil: new Date(Date.now() + 3600000),
      }),
    ).rejects.toThrow(/IDOS_BRNO_API_KEY required/);
  });
});
