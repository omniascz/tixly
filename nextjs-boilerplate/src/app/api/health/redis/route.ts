import { NextResponse } from 'next/server';
import { createClient } from 'redis';
import { checkRedisHealth } from '@/lib/health-check/health.service';

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
  const client = createClient({ url });
  try {
    await client.connect();
    const health = await checkRedisHealth(client);
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
    await client.quit().catch(() => {});
  }
}
