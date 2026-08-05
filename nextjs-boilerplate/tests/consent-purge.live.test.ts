/**
 * consent-purge.live.test.ts — GDPR purge nesmi tise selhavat.
 *
 * Puvodni catch polykal cokoli a vracel {ok:true, purged:0}, coz je
 * nerozlisitelne od poctiveho smazani nuly radku.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createLiveClone, hasNeonKey, type LiveClone } from './helpers/live-fixture';

const d = hasNeonKey ? describe : describe.skip;
const TOKEN = 'test-internal-token';
let clone: LiveClone;

const call = async () => {
  const { POST } = await import('@/app/api/internal/cron/consent-log-purge/route');
  const res = await POST(new Request('http://localhost:3000/api/internal/cron/consent-log-purge', {
    method: 'POST',
    headers: { 'x-internal-token': TOKEN },
  }) as never);
  return { status: res.status, body: await res.json() as Record<string, unknown> };
};

d('consent-log-purge', () => {
  beforeAll(async () => {
    clone = await createLiveClone('consent-purge', { migrations: [] });
    process.env.INTERNAL_SERVICE_TOKEN = TOKEN;
  }, 180_000);

  afterAll(async () => { await clone?.cleanup(); }, 120_000);

  it('tabulka EXISTUJE a DELETE projde — premisa puvodniho komentare byla nepravdiva', async () => {
    const t = await clone.pool.query<{ e: boolean }>(
      "SELECT to_regclass('compliance.cookie_consent_log') IS NOT NULL AS e");
    expect(t.rows[0].e).toBe(true);
  }, 60_000);

  it('smaze stare zaznamy a vrati skutecny pocet', async () => {
    // vsechny ostatni sloupce maji default; staci decided_at v minulosti
    await clone.pool.query(
      "INSERT INTO compliance.cookie_consent_log (decided_at) " +
      "SELECT NOW() - INTERVAL '200 days' FROM generate_series(1,3)");
    const r = await call();
    console.log('[purge]', r.status, JSON.stringify(r.body));
    expect(r.status).toBe(200);
    expect(r.body.ok).toBe(true);
    expect(Number(r.body.purged)).toBeGreaterThanOrEqual(3);
  }, 120_000);

  it('JINA chyba nez 42P01 se NEPOLYKA — vraci 500 a ok:false', async () => {
    // Prejmenovanim sloupce vyrobime 42703 (undefined_column), tedy chybu,
    // ktera NENI 42P01. Puvodni kod by vratil {ok:true, purged:0}.
    await clone.pool.query(
      'ALTER TABLE compliance.cookie_consent_log RENAME COLUMN decided_at TO decided_at_x');
    try {
      const r = await call();
      console.log('[purge 42703]', r.status, JSON.stringify(r.body));
      expect(r.status).toBe(500);
      expect(r.body.ok).toBe(false);
      expect(r.body.code).toBe('42703');
    } finally {
      await clone.pool.query(
        'ALTER TABLE compliance.cookie_consent_log RENAME COLUMN decided_at_x TO decided_at');
    }
  }, 120_000);

  it('42P01 se preskoci (tabulka fakt chybi)', async () => {
    await clone.pool.query('ALTER TABLE compliance.cookie_consent_log RENAME TO ccl_tmp');
    try {
      const r = await call();
      console.log('[purge 42P01]', r.status, JSON.stringify(r.body));
      expect(r.status).toBe(200);
      expect(r.body.ok).toBe(true);
      expect(r.body.skipped).toBe('table_missing');
    } finally {
      await clone.pool.query('ALTER TABLE compliance.ccl_tmp RENAME TO cookie_consent_log');
    }
  }, 120_000);
});
