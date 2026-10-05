import { describe, expect, it } from 'vitest';
import { assertStagingIsolated, stagingViolations } from './staging-guard';

const ok = {
  TIXLY_ENV: 'staging',
  DATABASE_URL: 'postgresql://tixly_app:x@ep-cool-staging-123.eu-central-1.aws.neon.tech/neondb?sslmode=require',
  APP_URL: 'https://tixly-staging.vercel.app',
  GOPAY_GOID: '8123456789', GOPAY_SANDBOX: 'true',
  COMGATE_MERCHANT: '123456', COMGATE_TEST: 'true',
  STRIPE_SECRET_KEY: 'sk_test_abc', STRIPE_PUBLISHABLE_KEY: 'pk_test_abc',
};

describe('staging guard (kolo 9 / krok 4)', () => {
  it('mimo staging nic nekontroluje', () => {
    expect(stagingViolations({ DATABASE_URL: 'postgresql://u:p@ep-weathered-wind-alvbjysw.c-3.eu-central-1.aws.neon.tech/neondb' })).toEqual([]);
  });

  it('izolovaný staging projde', () => {
    expect(stagingViolations(ok)).toEqual([]);
    expect(() => assertStagingIsolated(ok)).not.toThrow();
  });

  it('produkční DB (vestavěný endpoint i projekt, i v *_SUPER) odmítne', () => {
    expect(stagingViolations({ ...ok, DATABASE_URL: 'postgresql://u:p@ep-weathered-wind-alvbjysw.c-3.eu-central-1.aws.neon.tech/neondb' })[0])
      .toContain('DATABASE_URL ukazuje na produkční databázi');
    expect(stagingViolations({ ...ok, DATABASE_URL_SUPER: 'postgresql://neondb_owner:p@ep-x.neon.tech/neondb?options=project%3Dfragrant-wildflower-75132205' }))
      .toHaveLength(1);
    expect(stagingViolations({ ...ok, PROD_DB_HOSTS: 'db.prod.example', DATABASE_URL_OPS: 'postgresql://u:p@db.prod.example:5432/x' })).toHaveLength(1);
  });

  it('ostré brány a produkční doména odmítne', () => {
    const v = stagingViolations({
      ...ok, GOPAY_SANDBOX: 'false', COMGATE_TEST: 'false', STRIPE_SECRET_KEY: 'sk_live_x', APP_URL: 'https://app.tixly.cz',
      PAYPAL_CLIENT_ID: 'x', MOLLIE_API_KEY: 'live_x',
    });
    expect(v.join('\n')).toMatch(/GOPAY_SANDBOX/);
    expect(v.join('\n')).toMatch(/COMGATE_TEST/);
    expect(v.join('\n')).toMatch(/STRIPE_SECRET_KEY/);
    expect(v.join('\n')).toMatch(/APP_URL je produkční doména/);
    expect(v.join('\n')).toMatch(/PAYPAL_SANDBOX/);
    expect(v.join('\n')).toMatch(/MOLLIE_API_KEY/);
    expect(() => assertStagingIsolated({ ...ok, GOPAY_API_BASE_URL: 'https://gate.gopay.cz/api' })).toThrow(/staging-guard/);
  });
});
