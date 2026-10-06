/**
 * Kolo 11 / krok 1 — nic nesmí viset na síti.
 *
 * Vercel build (dpl_HWWquhd3qMF8yL6ShQXxJ4f713K8) skončil na „Static page generation for /api/health/redis is still timing
 * out after 3 attempts": node-redis 4 má výchozí reconnectStrategy = zkoušet donekonečna, takže `connect()` na nedostupný
 * host nikdy neskončí chybou. pg bez `connectionTimeoutMillis` čeká na TCP spojení taky bez omezení.
 *
 * Testy míří na nesměrovatelnou adresu 10.255.255.1 (spojení visí, není odmítnuto — přesně situace na Vercelu).
 * Požadavek: health routy vrátí 503 do 5 s, klienti Redis a DB mají timeout spojení i dotazu (Redis ≤ 5 s, bez
 * nekonečných opakování), každé `new Pool` / `new Client` / `createClient` v aplikaci jde přes sdílené volby s timeouty.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';

const BLACKHOLE_REDIS = 'redis://10.255.255.1:6379';
const BLACKHOLE_PG = 'postgresql://u:p@10.255.255.1:5432/x';
const SRC = join(__dirname, '..', 'src');
const saved = { REDIS_URL: process.env.REDIS_URL, DATABASE_URL: process.env.DATABASE_URL, DATABASE_URL_DIRECT: process.env.DATABASE_URL_DIRECT };

afterEach(() => {
  for (const [k, v] of Object.entries(saved)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
  vi.resetModules();
});

async function timed<T>(fn: () => Promise<T>): Promise<{ ms: number; value: T }> {
  const t = Date.now();
  const value = await fn();
  return { ms: Date.now() - t, value };
}

describe('health routy na nedostupnou síť → 503 do 5 s', () => {
  it('GET /api/health/redis', async () => {
    process.env.REDIS_URL = BLACKHOLE_REDIS;
    const { GET } = await import('@/app/api/health/redis/route');
    const { ms, value } = await timed(() => GET());
    expect(value.status).toBe(503);
    expect(ms).toBeLessThan(5500);
  }, 20_000);

  it('GET /api/health/ready (DB i Redis visí)', async () => {
    process.env.REDIS_URL = BLACKHOLE_REDIS;
    process.env.DATABASE_URL = BLACKHOLE_PG;
    const { GET } = await import('@/app/api/health/ready/route');
    const { ms, value } = await timed(() => GET());
    expect(value.status).toBe(503);
    expect(ms).toBeLessThan(5500);
  }, 20_000);
});

describe('klienti s timeouty', () => {
  it('Redis (redis-queue.getClient) na nedostupný host → null do 5,5 s, žádné nekonečné opakování', async () => {
    process.env.REDIS_URL = BLACKHOLE_REDIS;
    const { getClient } = await import('@/lib/queue/redis-queue');
    const { ms, value } = await timed(() => getClient());
    expect(value).toBeNull();
    expect(ms).toBeLessThan(5500);
  }, 20_000);

  // rls-pool drží connectionTimeoutMillis 8 s: v pg-pool platí i pro čekání na volné spojení pod náporem (zátěžový test).
  it('DB (rls-pool db().query) na nedostupný host → chyba do 8,5 s (ne nekonečně)', async () => {
    process.env.DATABASE_URL = BLACKHOLE_PG;
    process.env.DATABASE_URL_DIRECT = BLACKHOLE_PG;
    const { db } = await import('@/lib/db/rls-pool');
    const t = Date.now();
    await expect(db().query('SELECT 1')).rejects.toThrow();
    expect(Date.now() - t).toBeLessThan(8500);
    await (db() as unknown as { end: () => Promise<void> }).end().catch(() => {});
  }, 20_000);

  it('sdílené volby: pg i Redis mají timeout spojení i dotazu ≤ 5 s', async () => {
    const { pgPoolOptions, PG_CONNECT_TIMEOUT_MS } = await import('@/lib/db/pg-options');
    const o = pgPoolOptions('postgresql://x');
    expect(o.connectionTimeoutMillis).toBe(PG_CONNECT_TIMEOUT_MS);
    expect(PG_CONNECT_TIMEOUT_MS).toBeLessThanOrEqual(5000);
    expect(o.query_timeout).toBeGreaterThan(0);
    expect(o.statement_timeout).toBeGreaterThan(0);
    const { redisClientOptions, REDIS_CONNECT_TIMEOUT_MS, REDIS_COMMAND_TIMEOUT_MS } = await import('@/lib/redis/options');
    const r = redisClientOptions('redis://x');
    expect(r.socket?.connectTimeout).toBe(REDIS_CONNECT_TIMEOUT_MS);
    expect(REDIS_CONNECT_TIMEOUT_MS).toBeLessThanOrEqual(5000);
    expect(REDIS_COMMAND_TIMEOUT_MS).toBeLessThanOrEqual(5000);
    expect(r.disableOfflineQueue).toBe(true);
    const strategy = r.socket?.reconnectStrategy as (n: number, e: Error) => number | Error | false;
    expect(strategy(10, new Error('x'))).toBeInstanceOf(Error); // opakování končí
  });
});

describe('každý DB / Redis klient v aplikaci jde přes sdílené volby s timeouty', () => {
  function files(dir: string): string[] {
    const out: string[] = [];
    for (const n of readdirSync(dir)) {
      const p = join(dir, n);
      if (statSync(p).isDirectory()) out.push(...files(p));
      else if (/\.(ts|tsx)$/.test(n) && !/\.test\.tsx?$/.test(n)) out.push(p);
    }
    return out;
  }
  it('new Pool / new Client (pg) a createClient (redis) bez sdílených voleb', () => {
    const bad: string[] = [];
    for (const f of files(SRC)) {
      // bez řádků komentářů (dokumentace v rls-pool.ts zmiňuje `new Pool(...)`)
      const s = readFileSync(f, 'utf8').split(/\r?\n/).filter((l) => !/^\s*(\*|\/\/|\/\*)/.test(l)).join('\n');
      const rel = relative(SRC, f).replace(/\\/g, '/');
      for (const m of s.matchAll(/new (Pool|Client)\(\s*([^)]*)/g)) {
        if (!/pgPoolOptions|pgClientOptions/.test(m[2])) bad.push(`${rel}: new ${m[1]}(${m[2].slice(0, 40)})`);
      }
      for (const m of s.matchAll(/createClient\(\s*([^)]*)/g)) {
        if (!/redisClientOptions/.test(m[1])) bad.push(`${rel}: createClient(${m[1].slice(0, 40)})`);
      }
    }
    expect(bad).toEqual([]);
  });
});

describe('statické předgenerování (výstup next build, kolo 10) — síťové routy dynamické', () => {
  const app = (p: string) => readFileSync(join(SRC, 'app', p), 'utf8');
  it.each(['api/health/ready/route.ts', 'api/health/redis/route.ts', 'api/subscriptions/plans/route.ts', 'sitemap.ts'])(
    '%s: export const dynamic = force-dynamic', (p) => {
      expect(app(p)).toMatch(/^export const dynamic = 'force-dynamic';/m);
    });
  it('sitemap.xml: revalidate 1 hodina', () => {
    expect(app('sitemap.ts')).toMatch(/^export const revalidate = 3600;/m);
  });
});

