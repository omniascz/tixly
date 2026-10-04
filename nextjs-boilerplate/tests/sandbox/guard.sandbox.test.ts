// @vitest-environment node
/**
 * Ochrana sandbox testů (kolo 7): bez klíčů přeskočit s hláškou; nikdy produkční brána ani vzdálená DB.
 * Běží vždy (nepotřebuje klíče ani DB).
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { applySandboxEnv, assertSandboxTarget, missingSandboxEnv } from './sandbox-helpers';

const ENV_KEYS = [
  'GOPAY_SANDBOX_GOID', 'GOPAY_SANDBOX_CLIENT_ID', 'GOPAY_SANDBOX_CLIENT_SECRET', 'COMGATE_SANDBOX_MERCHANT', 'COMGATE_SANDBOX_SECRET',
  'GOPAY_API_BASE_URL', 'GOPAY_SANDBOX', 'COMGATE_TEST', 'COMGATE_API_BASE_URL', 'DATABASE_URL', 'FIX_DB_OWNER_URL', 'FIX_DB_APP_URL', 'FIX_E2E',
  'PAYMENT_PROVIDER', 'GOPAY_GOID', 'GOPAY_CLIENT_ID', 'GOPAY_CLIENT_SECRET', 'COMGATE_MERCHANT', 'COMGATE_SECRET',
];
const saved = Object.fromEntries(ENV_KEYS.map((k) => [k, process.env[k]]));
afterEach(() => {
  for (const k of ENV_KEYS) { if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k]; }
  vi.restoreAllMocks();
});

describe('sandbox — ochrana a přeskočení', () => {
  it('bez klíčů: vypíše co chybí (test se přeskočí)', () => {
    for (const k of ENV_KEYS) delete process.env[k];
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    expect(missingSandboxEnv('gopay')).toEqual(['GOPAY_SANDBOX_GOID', 'GOPAY_SANDBOX_CLIENT_ID', 'GOPAY_SANDBOX_CLIENT_SECRET', 'FIX_E2E=1 (izolovaná lokální DB)']);
    expect(warn.mock.calls[0][0]).toMatch(/\[sandbox:gopay\] PŘESKOČENO — chybí: GOPAY_SANDBOX_GOID/);
    expect(missingSandboxEnv('comgate')).toContain('COMGATE_SANDBOX_SECRET');
  });

  it('GoPay: sandbox projde, produkční gate.gopay.cz se odmítne', () => {
    Object.assign(process.env, { GOPAY_SANDBOX_GOID: '1', GOPAY_SANDBOX_CLIENT_ID: 'c', GOPAY_SANDBOX_CLIENT_SECRET: 's', DATABASE_URL: 'postgresql://u:p@localhost:55632/x' });
    const restore = applySandboxEnv('gopay');
    expect(process.env.GOPAY_API_BASE_URL).toBe('https://gw.sandbox.gopay.com/api');
    expect(() => assertSandboxTarget('gopay')).not.toThrow();
    process.env.GOPAY_API_BASE_URL = 'https://gate.gopay.cz/api';
    expect(() => assertSandboxTarget('gopay')).toThrow(/není sandbox/);
    restore();
  });

  it('ComGate: jen test režim', () => {
    Object.assign(process.env, { COMGATE_SANDBOX_MERCHANT: 'm', COMGATE_SANDBOX_SECRET: 's', DATABASE_URL: 'postgresql://u:p@127.0.0.1:55632/x' });
    const restore = applySandboxEnv('comgate');
    expect(() => assertSandboxTarget('comgate')).not.toThrow();
    process.env.COMGATE_TEST = 'false';
    expect(() => assertSandboxTarget('comgate')).toThrow(/test režimu/);
    restore();
  });

  it('vzdálená databáze (např. Neon) se odmítne', () => {
    Object.assign(process.env, { GOPAY_SANDBOX_GOID: '1', GOPAY_SANDBOX_CLIENT_ID: 'c', GOPAY_SANDBOX_CLIENT_SECRET: 's' });
    const restore = applySandboxEnv('gopay');
    process.env.DATABASE_URL = 'postgresql://u:p@ep-example-pooler.eu-central-1.aws.neon.tech/neondb';
    expect(() => assertSandboxTarget('gopay')).toThrow(/jen proti lokální izolované DB/);
    restore();
  });
});
