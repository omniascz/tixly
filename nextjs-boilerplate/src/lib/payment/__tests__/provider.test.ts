import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { createPayment } from '../provider';
import { _resetGopayCacheForTests } from '../gopay-real';
import { _resetComGateCacheForTests } from '../comgate';

const baseInput = {
  orderId: 'test-order-001',
  amountHalire: 50000,
  currency: 'CZK',
  buyerEmail: 'buyer@example.com',
  description: 'Romeo a Julie · 2 vstupenky',
  appUrl: 'http://localhost:3000',
};

describe('createPayment provider routing', () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    _resetGopayCacheForTests();
    _resetComGateCacheForTests();
    delete process.env.PAYMENT_PROVIDER;
    delete process.env.PAYMENT_PROVIDER_EUR;
    delete process.env.GOPAY_GOID;
    delete process.env.GOPAY_CLIENT_ID;
    delete process.env.GOPAY_CLIENT_SECRET;
    delete process.env.COMGATE_MERCHANT;
    delete process.env.COMGATE_SECRET;
    delete process.env.STRIPE_SECRET_KEY;
  });

  afterEach(() => {
    process.env = { ...originalEnv };
    _resetGopayCacheForTests();
    _resetComGateCacheForTests();
  });

  it('bez env → mock-gopay fallback', async () => {
    const r = await createPayment({ ...baseInput, paymentMethod: 'gopay' });
    expect(r.provider).toBe('mock-gopay');
    expect(r.gatewayUrl).toMatch(/^\/mock-gopay\//);
  });

  it('PAYMENT_PROVIDER=gopay bez credentials → mock fallback', async () => {
    process.env.PAYMENT_PROVIDER = 'gopay';
    const r = await createPayment({ ...baseInput, paymentMethod: 'gopay' });
    expect(r.provider).toBe('mock-gopay');
  });

  it('bank_transfer → confirmation URL bez bráním na gate', async () => {
    const r = await createPayment({ ...baseInput, paymentMethod: 'bank_transfer' });
    expect(r.provider).toBe('bank_transfer');
    expect(r.gatewayUrl).toContain('/order-confirmation/');
    expect(r.gatewayUrl).toContain('awaiting=bank_transfer');
  });

  it('wero → mock-wero', async () => {
    const r = await createPayment({ ...baseInput, paymentMethod: 'wero' });
    expect(r.provider).toBe('mock-wero');
    expect(r.gatewayUrl).toMatch(/^\/mock-wero\//);
  });

  it('przelewy24 → mock-przelewy24', async () => {
    const r = await createPayment({ ...baseInput, paymentMethod: 'przelewy24' });
    expect(r.provider).toBe('mock-przelewy24');
    expect(r.gatewayUrl).toMatch(/^\/mock-przelewy24\//);
  });

  it('GoPay s plnou konfigurací volá reálné API', async () => {
    process.env.PAYMENT_PROVIDER = 'gopay';
    process.env.GOPAY_GOID = '8123456789';
    process.env.GOPAY_CLIENT_ID = 'cid';
    process.env.GOPAY_CLIENT_SECRET = 'cs';

    // Mock fetch
    const fetchSpy = vi.spyOn(global, 'fetch').mockResolvedValueOnce(
      new Response(
        JSON.stringify({ access_token: 'tok123', expires_in: 1800 }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      ),
    ).mockResolvedValueOnce(
      new Response(
        JSON.stringify({ id: 99999, gw_url: 'https://gate.gopay.cz/pay/abc' }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      ),
    );

    const r = await createPayment({ ...baseInput, paymentMethod: 'gopay' });
    expect(r.provider).toBe('gopay');
    expect(r.paymentId).toBe('99999');
    expect(r.gatewayUrl).toBe('https://gate.gopay.cz/pay/abc');
    expect(fetchSpy).toHaveBeenCalledTimes(2);
    fetchSpy.mockRestore();
  });

  it('ComGate s plnou konfigurací volá reálné API', async () => {
    process.env.PAYMENT_PROVIDER = 'comgate';
    process.env.COMGATE_MERCHANT = 'CG-XXX';
    process.env.COMGATE_SECRET = 'sup3rsecret';

    const fetchSpy = vi.spyOn(global, 'fetch').mockResolvedValueOnce(
      new Response(
        JSON.stringify({ transId: 'TX-555', redirect: 'https://payments.comgate.cz/pay/TX-555' }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      ),
    );

    const r = await createPayment({ ...baseInput, paymentMethod: 'gopay' });
    expect(r.provider).toBe('comgate');
    expect(r.paymentId).toBe('TX-555');
    fetchSpy.mockRestore();
  });

  it('PAYMENT_PROVIDER_EUR přepíše pro EUR objednávku', async () => {
    process.env.PAYMENT_PROVIDER = 'gopay';
    process.env.PAYMENT_PROVIDER_EUR = 'comgate';
    process.env.GOPAY_GOID = '111';
    process.env.GOPAY_CLIENT_ID = 'a';
    process.env.GOPAY_CLIENT_SECRET = 'b';
    process.env.COMGATE_MERCHANT = 'CG-EUR';
    process.env.COMGATE_SECRET = 'eursec';

    const fetchSpy = vi.spyOn(global, 'fetch').mockResolvedValueOnce(
      new Response(
        JSON.stringify({ transId: 'TX-EUR-1', redirect: 'https://comgate/eur' }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      ),
    );

    const r = await createPayment({ ...baseInput, currency: 'EUR', paymentMethod: 'gopay' });
    expect(r.provider).toBe('comgate');
    fetchSpy.mockRestore();
  });
});
