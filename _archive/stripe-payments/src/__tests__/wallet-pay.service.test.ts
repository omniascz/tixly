import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  createWalletPaymentIntent,
  registerApplePayDomain,
  getStripePublishableKey,
  validateApplePayMerchant,
} from '../services/wallet-pay.service.js';
import type { DbAdapter } from '../services/wallet-pay.service.js';

function makeDb(executeMock = vi.fn()): DbAdapter {
  return {
    query: vi.fn().mockResolvedValue([]),
    execute: executeMock,
  };
}

function mockStripeResponse(body: object, ok = true) {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
    ok,
    status: ok ? 200 : 400,
    json: vi.fn().mockResolvedValue(body),
  }));
}

beforeEach(() => {
  vi.unstubAllGlobals();
  process.env.STRIPE_SECRET_KEY = 'sk_test_fake';
  process.env.STRIPE_PUBLISHABLE_KEY = 'pk_test_fake';
});

describe('createWalletPaymentIntent', () => {
  it('vytvoří PaymentIntent s Apple/Google Pay podporou', async () => {
    mockStripeResponse({
      id: 'pi_test_123',
      client_secret: 'pi_test_123_secret',
      amount: 66550,
      currency: 'czk',
      payment_method_types: ['card'],
    });

    const executeMock = vi.fn().mockResolvedValue(undefined);
    const db = makeDb(executeMock);

    const result = await createWalletPaymentIntent(
      'order-001',
      66550,
      'CZK',
      { order_id: 'order-001', user_id: 'user-001' },
      db,
    );

    expect(result.paymentIntentId).toBe('pi_test_123');
    expect(result.clientSecret).toBe('pi_test_123_secret');
    expect(result.paymentMethods).toContain('apple_pay');
    expect(result.paymentMethods).toContain('google_pay');
    expect(executeMock).toHaveBeenCalledTimes(2);  // update order + payment event
  });

  it('vyhodí VALIDATION_ERROR pro nulovou částku', async () => {
    const db = makeDb();

    await expect(
      createWalletPaymentIntent('order-001', 0, 'CZK', {}, db),
    ).rejects.toThrow('VALIDATION_ERROR');
  });

  it('vyhodí chybu pokud chybí STRIPE_SECRET_KEY', async () => {
    delete process.env.STRIPE_SECRET_KEY;
    const db = makeDb();

    await expect(
      createWalletPaymentIntent('order-001', 1000, 'CZK', {}, db),
    ).rejects.toThrow('STRIPE_KEY_MISSING');
  });
});

describe('registerApplePayDomain', () => {
  it('registruje doménu pro Apple Pay', async () => {
    mockStripeResponse({ id: 'apwc_test', object: 'apple_pay_domain', domain_name: 'tixly.io' });

    const result = await registerApplePayDomain('tixly.io');

    expect(result.registered).toBe(true);
    expect(result.domain).toBe('tixly.io');
  });

  it('vrátí registered=true pokud je doména již zaregistrována', async () => {
    mockStripeResponse({ error: { message: 'Domain already registered' } }, false);

    const result = await registerApplePayDomain('tixly.io');

    expect(result.registered).toBe(true);
  });

  it('vyhodí VALIDATION_ERROR pro neplatnou doménu', async () => {
    await expect(registerApplePayDomain('invalid')).rejects.toThrow('VALIDATION_ERROR');
    await expect(registerApplePayDomain('')).rejects.toThrow('VALIDATION_ERROR');
  });
});

describe('getStripePublishableKey', () => {
  it('vrátí publishable key z env', () => {
    const key = getStripePublishableKey();
    expect(key).toBe('pk_test_fake');
  });

  it('vyhodí chybu pokud key není nastaven', () => {
    delete process.env.STRIPE_PUBLISHABLE_KEY;
    expect(() => getStripePublishableKey()).toThrow('STRIPE_PUBLISHABLE_KEY not set');
  });
});

describe('validateApplePayMerchant', () => {
  it('ověří Apple Pay merchant session', async () => {
    mockStripeResponse({ merchantSession: 'mock-session-data' });

    const result = await validateApplePayMerchant(
      'https://apple-pay-gateway.apple.com/paymentservices/startSession',
      'tixly.io',
    );

    expect(result).toBeDefined();
    expect(fetch).toHaveBeenCalledWith(
      'https://api.stripe.com/v1/apple_pay/sessions',
      expect.objectContaining({ method: 'POST' }),
    );
  });

  it('vyhodí VALIDATION_ERROR pro http URL', async () => {
    await expect(
      validateApplePayMerchant('http://insecure.example.com', 'tixly.io'),
    ).rejects.toThrow('VALIDATION_ERROR');
  });
});
