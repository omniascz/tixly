import { NextResponse } from 'next/server';
import { pgClientOptions } from '@/lib/db/pg-options';
import { withTimeout } from '@/lib/net/with-timeout';
import { redisClientOptions, withRedisTimeout } from '@/lib/redis/options';

// Kolo 11: GET bez request — Next 14 by ho při buildu předgeneroval a připojoval se k DB i Redisu.
export const dynamic = 'force-dynamic';

/** Každá kontrola má vlastní limit; běží souběžně → odpověď (i 503) vždy do 5 s. */
const CHECK_BUDGET_MS = 4000;

// Readiness probe — ověří připojení k DB a Redis.
// Vrací 200 OK pouze pokud jsou obě služby dostupné.
// Používá se v CI před spuštěním integračních testů.
export async function GET(): Promise<Response> {
  const checks: Record<string, string> = {};

  const dbCheck = (async () => {
    const { Client } = await import('pg');
    const client = new Client(pgClientOptions(process.env.DATABASE_URL));
    client.on('error', () => {});
    try {
      await withTimeout(
        (async () => { await client.connect(); await client.query('SELECT 1'); })(),
        CHECK_BUDGET_MS,
        'DB health',
      );
      checks.database = 'ok';
    } catch {
      checks.database = 'error';
    } finally {
      void client.end().catch(() => {});
    }
  })();

  const redisCheck = (async () => {
    const { createClient } = await import('redis');
    const redis = createClient(redisClientOptions(process.env.REDIS_URL));
    redis.on('error', () => {});
    try {
      await withRedisTimeout(
        (async () => { await redis.connect(); await redis.ping(); })(),
        CHECK_BUDGET_MS,
        'Redis health',
      );
      checks.redis = 'ok';
    } catch {
      checks.redis = 'error';
    } finally {
      await redis.disconnect().catch(() => {});
    }
  })();

  await Promise.all([dbCheck, redisCheck]);

  const allOk = Object.values(checks).every((v) => v === 'ok');

  const statusCode = allOk ? 200 : 503;
  const responseStatus = allOk ? 'ok' : 'degraded';

  return NextResponse.json(
    { status: responseStatus, checks },
    { status: statusCode },
  );
}
