import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { getComGateConfig, _resetComGateCacheForTests } from '../comgate';

describe('getComGateConfig', () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    _resetComGateCacheForTests();
    delete process.env.COMGATE_MERCHANT;
    delete process.env.COMGATE_SECRET;
    delete process.env.COMGATE_TEST;
    delete process.env.COMGATE_API_BASE_URL;
  });

  afterEach(() => {
    process.env = { ...originalEnv };
    _resetComGateCacheForTests();
  });

  it('isConfigured=false bez env', () => {
    const config = getComGateConfig();
    expect(config.isConfigured).toBe(false);
  });

  it('isConfigured=true s merchant + secret', () => {
    process.env.COMGATE_MERCHANT = 'CG123456';
    process.env.COMGATE_SECRET = 'topsecret';
    const config = getComGateConfig();
    expect(config.isConfigured).toBe(true);
    expect(config.merchant).toBe('CG123456');
  });

  it('isConfigured=false pokud chybí secret', () => {
    process.env.COMGATE_MERCHANT = 'CG123456';
    const config = getComGateConfig();
    expect(config.isConfigured).toBe(false);
  });

  it('test mode přes COMGATE_TEST=true', () => {
    process.env.COMGATE_MERCHANT = 'CG123456';
    process.env.COMGATE_SECRET = 'topsecret';
    process.env.COMGATE_TEST = 'true';
    const config = getComGateConfig();
    expect(config.test).toBe(true);
  });

  it('default API URL', () => {
    const config = getComGateConfig();
    expect(config.apiBaseUrl).toBe('https://payments.comgate.cz/v2.0');
  });

  it('cache funguje', () => {
    process.env.COMGATE_MERCHANT = 'A';
    process.env.COMGATE_SECRET = 'B';
    const first = getComGateConfig();
    process.env.COMGATE_MERCHANT = 'C'; // změna nemá efekt
    const second = getComGateConfig();
    expect(second).toBe(first);
  });
});
