// @vitest-environment node
/**
 * Kolo 7 / krok 5 — cron expire-date-holds. Routa /api/internal/cron/expire-date-holds existovala, ale
 * nebyla ve vercel.json ani v allowlistu dispatcheru → opce s prošlou lhůtou nikdy nepropadly a druhý
 * zájemce v pořadí čekal navždy.
 *
 * Očekávané: vercel.json ji volá přes /api/cron/dispatch (hodinově), dispatcher ji pouští jen s CRON_SECRET
 * (lib/security/cron-auth.ts) a předá x-internal-token; běh označí prošlou opci jako expired a posune další.
 * Kontrakt: každý job z vercel.json je v allowlistu dispatcheru a má routu.
 */
import { existsSync, readFileSync } from 'fs';
import path from 'path';
import { randomUUID } from 'crypto';
import type { NextRequest } from 'next/server';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createLocalClone, hasLocalDb, type LocalClone } from './helpers/local-fixture';
import { throughMiddleware } from './helpers/through-middleware';

const run = describe.skipIf(!hasLocalDb);
type H = (r: NextRequest) => Promise<Response>;
const ROOT = path.resolve(__dirname, '..');

const vercelJobs = (): { job: string; schedule: string }[] => {
  const v = JSON.parse(readFileSync(path.join(ROOT, 'vercel.json'), 'utf8')) as { crons: { path: string; schedule: string }[] };
  return v.crons
    .map((c) => ({ m: /^\/api\/cron\/dispatch\?job=([a-z0-9-]+)$/.exec(c.path), schedule: c.schedule }))
    .filter((x): x is { m: RegExpExecArray; schedule: string } => x.m !== null)
    .map((x) => ({ job: x.m[1], schedule: x.schedule }));
};
const allowedJobs = (): Set<string> => {
  const src = readFileSync(path.join(ROOT, 'src/app/api/cron/dispatch/route.ts'), 'utf8');
  const block = /const ALLOWED_JOBS = new Set\(\[([\s\S]*?)\]\);/.exec(src)?.[1] ?? '';
  return new Set([...block.matchAll(/^\s*'([a-z0-9-]+)'/gm)].map((m) => m[1]));
};

describe('Kolo 7 — cron expire-date-holds je naplánovaný', () => {
  it('vercel.json volá expire-date-holds přes dispatcher hodinově', () => {
    expect(vercelJobs()).toContainEqual({ job: 'expire-date-holds', schedule: '0 * * * *' });
  });

  it('kontrakt: každý job z vercel.json je v allowlistu dispatcheru a má routu', () => {
    const allowed = allowedJobs();
    const bad = vercelJobs()
      .filter(({ job }) => !allowed.has(job) || !existsSync(path.join(ROOT, 'src/app/api/internal/cron', job, 'route.ts')))
      .map(({ job }) => job);
    expect(bad).toEqual([]);
    expect(allowed.has('expire-date-holds')).toBe(true);
  });
});

run('Kolo 7 — cron expire-date-holds naživo přes dispatcher', () => {
  let clone: LocalClone;
  const realFetch = globalThis.fetch;
  beforeAll(async () => { clone = await createLocalClone(); }, 120_000);
  afterAll(async () => { globalThis.fetch = realFetch; await clone?.cleanup(); }, 30_000);

  const req = (p: string, headers: Record<string, string> = {}) =>
    new Request(`http://localhost${p}`, { method: 'GET', headers: { 'content-type': 'application/json', ...headers } });

  it('bez CRON_SECRET 403; s ním prošlá opce → expired a druhá v pořadí se posune na první', async () => {
    const c = await clone.seed.chain();
    const day = new Date(Date.now() + 40 * 86_400_000).toISOString().slice(0, 10);
    const ins = async (rank: number, expires: string | null) => (await clone.pool.query<{ id: string }>(
      `INSERT INTO catalog.venue_date_holds (venue_id, promoter_id, hold_date, option_rank, title, expires_at)
       VALUES ($1, $2, $3::date, $4, $5, $6::timestamptz) RETURNING id`,
      [c.venueId, c.promoterId, day, rank, `Opce ${rank} ${randomUUID().slice(0, 6)}`, expires])).rows[0].id;
    const first = await ins(1, new Date(Date.now() - 3_600_000).toISOString());
    const second = await ins(2, new Date(Date.now() + 7 * 86_400_000).toISOString());

    const { GET: dispatch } = await import('@/app/api/cron/dispatch/route');
    const { POST: job } = await import('@/app/api/internal/cron/expire-date-holds/route');
    const forwarded: Record<string, string | null> = {};
    // Odchozí volání dispatcheru doručíme in-process skutečnému handleru — beze změny hlaviček.
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const u = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url);
      if (u.pathname === '/api/internal/cron/expire-date-holds') {
        forwarded.internal = new Headers(init?.headers).get('x-internal-token');
        return throughMiddleware(new Request(`http://localhost${u.pathname}`, init), job as H);
      }
      return realFetch(input, init);
    }) as typeof fetch;
    try {
      expect((await throughMiddleware(req('/api/cron/dispatch?job=expire-date-holds'), dispatch as H)).status).toBe(403);
      expect((await throughMiddleware(req('/api/cron/dispatch?job=expire-date-holds', { authorization: 'Bearer wrong' }), dispatch as H)).status).toBe(403);
      const status = async (id: string) =>
        (await clone.pool.query(`SELECT status, option_rank FROM catalog.venue_date_holds WHERE id=$1`, [id])).rows[0];
      expect(await status(first)).toEqual({ status: 'held', option_rank: 1 });

      const r = await throughMiddleware(req('/api/cron/dispatch?job=expire-date-holds', { authorization: `Bearer ${process.env.CRON_SECRET}` }), dispatch as H);
      const body = (await r.json()) as { status: number; result: { expiredCount: number; promotedToPrimary: string[] } };
      expect(body.status, JSON.stringify(body)).toBe(200);
      expect(forwarded.internal).toBe(process.env.INTERNAL_SERVICE_TOKEN);
      expect(body.result.expiredCount).toBeGreaterThanOrEqual(1);
      expect(body.result.promotedToPrimary).toContain(second);
      expect(await status(first)).toEqual({ status: 'expired', option_rank: 1 });
      expect(await status(second)).toEqual({ status: 'held', option_rank: 1 });
    } finally { globalThis.fetch = realFetch; }
  });
});
