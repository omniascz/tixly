/**
 * cron-contract.live.test.ts — kontrakt C2: cron NIKDY nesmi hlasit uspech,
 * ktery nenastal.
 *
 * Tvar odpovedi: { ok, processed, failed, errors[] }, ok === false kdyz failed > 0.
 * HTTP zustava 200 — jedna polozka z tisice nesmi shodit cely beh; signal nese
 * telo, ne status.
 *
 * Selhani zapisu se VYNUCUJE (odebranim prava na tabulku), ne simuluje mockem.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { randomUUID } from 'crypto';
import { NextRequest } from 'next/server';
import { createLiveClone, hasNeonKey, type LiveClone } from './helpers/live-fixture';

const d = hasNeonKey ? describe : describe.skip;
let clone: LiveClone;
const SECRET = 'test-cron-secret';

const call = async (mod: string, path: string) => {
  const { POST } = await import(mod);
  const res = await POST(new NextRequest(`http://localhost:3000${path}`, {
    method: 'POST', headers: { 'x-internal-token': SECRET },
  }) as never);
  return { status: res.status, body: await res.json() as Record<string, unknown> };
};

d('kontrakt cronu (C2)', () => {
  beforeAll(async () => {
    clone = await createLiveClone('cron-contract');
    process.env.INTERNAL_SERVICE_TOKEN = SECRET;
  }, 180_000);

  afterAll(async () => { await clone?.cleanup(); }, 120_000);

  it('consent-log-purge: pri odepreni prava NEVRATI ok:true', async () => {
    // REVOKE nestacil (prava chodi i pres default privileges), takze selhani
    // vynucuji triggerem — ten se obejit neda.
    await clone.pool.query(`CREATE OR REPLACE FUNCTION audit._boom() RETURNS trigger
      LANGUAGE plpgsql AS $fn$ BEGIN RAISE EXCEPTION 'vynucene selhani zapisu'; END $fn$`);
    await clone.pool.query(`CREATE TRIGGER _boom BEFORE DELETE ON audit.consent_log
      FOR EACH STATEMENT EXECUTE FUNCTION audit._boom()`).catch((e) => console.log('trig:', e.code));
    const out = await call('@/app/api/internal/cron/consent-log-purge/route',
      '/api/internal/cron/consent-log-purge');
    console.log('[consent-log-purge]', out.status, JSON.stringify(out.body).slice(0, 160));
    expect(out.body.ok).not.toBe(true);
    expect(out.body).toHaveProperty('failed');
    expect(out.body).toHaveProperty('errors');
    await clone.pool.query('DROP TRIGGER IF EXISTS _boom ON audit.consent_log').catch(() => undefined);
  }, 120_000);

  it('verify-event-completion: pri rozbitem uvodnim dotazu NEVRATI ok:true', async () => {
    await clone.pool.query('REVOKE ALL ON catalog.events FROM tixly_app').catch(() => undefined);
    const out = await call('@/app/api/internal/cron/verify-event-completion/route',
      '/api/internal/cron/verify-event-completion');
    console.log('[verify-event-completion]', out.status, JSON.stringify(out.body).slice(0, 160));
    expect(out.body.ok).toBe(false);
    expect(out.body.failed).toBeGreaterThan(0);
    await clone.pool.query('GRANT SELECT, INSERT, UPDATE, DELETE ON catalog.events TO tixly_app')
      .catch(() => undefined);
  }, 120_000);

  it('seat-upgrade-notify: tvar odpovedi obsahuje failed i errors', async () => {
    const out = await call('@/app/api/internal/cron/seat-upgrade-notify/route',
      '/api/internal/cron/seat-upgrade-notify');
    console.log('[seat-upgrade-notify]', out.status, JSON.stringify(out.body).slice(0, 160));
    if (out.status === 200) {
      expect(out.body).toHaveProperty('failed');
      expect(out.body).toHaveProperty('errors');
      expect(out.body).toHaveProperty('processed');
    }
    void randomUUID();
  }, 120_000);
});
