import { NextResponse } from 'next/server';
import { createClient } from 'redis';
import { checkRedisHealth } from '@/lib/health-check/health.service';
import { redisClientOptions, withRedisTimeout } from '@/lib/redis/options';

// Kolo 11: Next 14 tuto routu (GET bez request) při buildu předgeneroval — na Vercelu se spojení k Redisu zaseklo
// a build skončil „Static page generation for /api/health/redis is still timing out after 3 attempts".
export const dynamic = 'force-dynamic';

/** Celkový limit probe — odpověď (i 503) vždy do 5 s. */
const PROBE_BUDGET_MS = 4000;

/**
 * GET /api/health/redis — Redis readiness probe.
 * 200 ok / 503 unreachable. Pinges přes PING.
 *
 * Pozn.: vytváříme krátkodobý klient místo singletonu — health probe by neměla
 * sdílet connection pool s app (jinak při potížích app neumře nezávisle).
 */
export async function GET(): Promise<Response> {
  const url = process.env.REDIS_URL;
  if (!url) {
    return NextResponse.json(
      { status: 'error', responseTime: 0, error: 'REDIS_URL not set' },
      { status: 503 },
    );
  }
  const client = createClient(redisClientOptions(url));
  client.on('error', () => {}); // chyby řeší connect()/ping níž; bez posluchače by node-redis shodil proces
  try {
    const health = await withRedisTimeout(
      (async () => { await client.connect(); return checkRedisHealth(client); })(),
      PROBE_BUDGET_MS,
      'Redis health',
    );
    const statusCode = health.status === 'error' ? 503 : 200;
    return NextResponse.json(health, { status: statusCode });
  } catch (error) {
    return NextResponse.json(
      {
        status: 'error',
        responseTime: 0,
        error: error instanceof Error ? error.message : 'Redis check failed',
      },
      { status: 503 },
    );
  } finally {
    // disconnect (ne quit): nečeká na odpověď serveru a zastaví případné opakování spojení
    await client.disconnect().catch(() => {});
  }
}
