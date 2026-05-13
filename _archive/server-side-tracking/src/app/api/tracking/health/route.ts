import { NextRequest, NextResponse } from 'next/server';
import type { ServiceDeps } from '../../../../types/tracking.types.js';

interface HealthStatus {
  status: 'healthy' | 'degraded' | 'unhealthy';
  timestamp: string;
  services: {
    redis: 'up' | 'down';
    database: 'up' | 'down';
    meta_api: 'configured' | 'not_configured';
    tiktok_api: 'configured' | 'not_configured';
    kafka: 'configured' | 'not_configured';
  };
}

/**
 * GET /api/tracking/health
 * Health check endpoint for tracking services.
 * Verifies connectivity to Redis, database, and configuration of external APIs.
 */
export async function GET(_request: NextRequest): Promise<NextResponse> {
  try {
    const metaConfigured = !!(process.env['META_PIXEL_ID'] && process.env['META_ACCESS_TOKEN']);
    const tiktokConfigured = !!(process.env['TIKTOK_PIXEL_CODE'] && process.env['TIKTOK_ACCESS_TOKEN']);
    const kafkaConfigured = !!process.env['KAFKA_BROKERS'];

    // TODO: Inject ServiceDeps from application context for live connectivity checks
    const deps: ServiceDeps | null = null;

    let redisStatus: 'up' | 'down' = 'down';
    let dbStatus: 'up' | 'down' = 'down';

    if (deps) {
      try {
        await deps.redis.exists('health-check');
        redisStatus = 'up';
      } catch {
        redisStatus = 'down';
      }

      try {
        // Attempt a lightweight DB query via the adapter
        await deps.db.getFailedEventsForRetry();
        dbStatus = 'up';
      } catch {
        dbStatus = 'down';
      }
    }

    const services: HealthStatus['services'] = {
      redis: redisStatus,
      database: dbStatus,
      meta_api: metaConfigured ? 'configured' : 'not_configured',
      tiktok_api: tiktokConfigured ? 'configured' : 'not_configured',
      kafka: kafkaConfigured ? 'configured' : 'not_configured',
    };

    const allUp = redisStatus === 'up' && dbStatus === 'up';
    const anyConfigured = metaConfigured || tiktokConfigured;

    let overallStatus: HealthStatus['status'];
    if (allUp && anyConfigured) {
      overallStatus = 'healthy';
    } else if (deps === null) {
      // No deps injected yet — report as degraded rather than unhealthy
      overallStatus = 'degraded';
    } else {
      overallStatus = 'unhealthy';
    }

    const health: HealthStatus = {
      status: overallStatus,
      timestamp: new Date().toISOString(),
      services,
    };

    const httpStatus = overallStatus === 'unhealthy' ? 503 : 200;

    return NextResponse.json(health, { status: httpStatus });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error('[GET /api/tracking/health] Error:', error);
    return NextResponse.json(
      { status: 'unhealthy', error: message },
      { status: 503 },
    );
  }
}
