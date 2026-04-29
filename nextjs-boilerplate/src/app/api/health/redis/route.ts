import { NextResponse } from 'next/server';
import { checkRedisHealth } from '@/lib/health-check/health.service';

/**
 * GET /api/health/redis
 *
 * Redis-only health check endpoint
 * Fast endpoint for Redis connectivity verification
 * Target response time: < 50ms
 *
 * @returns Redis health status with response time
 */
export async function GET() {
  try {
    // In production, you would initialize and pass the actual Redis client:
    // const redis = getRedis(); // your redis initialization
    // const health = await checkRedisHealth(redis);

    // For now, return error state (no client initialized)
    const health = await checkRedisHealth(undefined);

    const statusCode = health.status === 'ok' ? 200 : health.status === 'slow' ? 200 : 503;

    return NextResponse.json(health, { status: statusCode });
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Redis check failed';

    return NextResponse.json(
      {
        status: 'error',
        responseTime: 0,
        error: errorMessage,
      },
      { status: 503 },
    );
  }
}
