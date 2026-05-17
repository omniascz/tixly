import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { getGopayConfig, _resetGopayCacheForTests } from '../gopay-real';

describe('getGopayConfig', () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    _resetGopayCacheForTests();
    // Clear GoPay env
    delete process.env.GOPAY_GOID;
    delete process.env.GOPAY_CLIENT_ID;
    delete process.env.GOPAY_CLIENT_SECRET;
    delete process.env.GOPAY_API_BASE_URL;
    delete process.env.GOPAY_SANDBOX;
  });

  afterEach(() => {
    process.env = { ...originalEnv };
    _resetGopayCacheForTests();
  });

  it('isConfigured=false bez env (mock režim)', () => {
    const config = getGopayConfig();
    expect(config.isConfigured).toBe(false);
    expect(config.goid).toBe(0);
  });

  it('isConfigured=true s plnou konfigurací', () => {
    process.env.GOPAY_GOID = '8123456789';
    process.env.GOPAY_CLIENT_ID = 'client-id-test';
    process.env.GOPAY_CLIENT_SECRET = 'secret-test';
    const config = getGopayConfig();
    expect(config.isConfigured).toBe(true);
    expect(config.goid).toBe(8123456789);
  });

  it('isConfigured=false pokud chybí client_id', () => {
    process.env.GOPAY_GOID = '8123456789';
    process.env.GOPAY_CLIENT_SECRET = 'secret-test';
    const config = getGopayConfig();
    expect(config.isConfigured).toBe(false);
  });

  it('sandbox URL pokud GOPAY_SANDBOX=true a žádný explicit URL', () => {
    process.env.GOPAY_SANDBOX = 'true';
    const config = getGopayConfig();
    expect(config.apiBaseUrl).toBe('https://gw.sandbox.gopay.com/api');
  });

  it('production URL default', () => {
    const config = getGopayConfig();
    expect(config.apiBaseUrl).toBe('https://gate.gopay.cz/api');
  });

  it('explicit GOPAY_API_BASE_URL vyhrává', () => {
    process.env.GOPAY_API_BASE_URL = 'https://custom.gopay.test/api';
    const config = getGopayConfig();
    expect(config.apiBaseUrl).toBe('https://custom.gopay.test/api');
  });

  it('odmítne neplatný GOID', () => {
    process.env.GOPAY_GOID = 'not-a-number';
    process.env.GOPAY_CLIENT_ID = 'x';
    process.env.GOPAY_CLIENT_SECRET = 'y';
    const config = getGopayConfig();
    expect(config.isConfigured).toBe(false);
  });

  it('cache funguje (druhé volání nenahodí znovu)', () => {
    process.env.GOPAY_GOID = '111';
    process.env.GOPAY_CLIENT_ID = 'a';
    process.env.GOPAY_CLIENT_SECRET = 'b';
    const first = getGopayConfig();
    process.env.GOPAY_GOID = '222'; // změna env nemá efekt — cache
    const second = getGopayConfig();
    expect(second.goid).toBe(111);
    expect(second).toBe(first);
  });
});
