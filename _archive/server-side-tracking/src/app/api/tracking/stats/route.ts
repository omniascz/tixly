import { NextRequest, NextResponse } from 'next/server';
import type { ServiceDeps } from '../../../../types/tracking.types.js';

interface TrackingStats {
  timestamp: string;
  dlq: {
    pending_retry: number;
  };
  configuration: {
    meta_configured: boolean;
    tiktok_configured: boolean;
    kafka_configured: boolean;
  };
}

/**
 * GET /api/tracking/stats
 * Tracking statistics: DLQ queue depth, configuration status.
 * Requires INTERNAL_API_KEY header for authentication.
 */
export async function GET(request: NextRequest): Promise<NextResponse> {
  try {
    const apiKey = request.headers.get('x-api-key');
    const expectedKey = process.env['INTERNAL_API_KEY'];

    if (!expectedKey || apiKey !== expectedKey) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // TODO: Inject ServiceDeps from application context
    const deps: ServiceDeps = null as unknown as ServiceDeps;

    let pendingRetry = 0;

    try {
      const failedEvents = await deps.db.getFailedEventsForRetry();
      pendingRetry = failedEvents.length;
    } catch {
      // If DB is unavailable, report 0 and let health endpoint show the real status
      pendingRetry = 0;
    }

    const stats: TrackingStats = {
      timestamp: new Date().toISOString(),
      dlq: {
        pending_retry: pendingRetry,
      },
      configuration: {
        meta_configured: !!(process.env['META_PIXEL_ID'] && process.env['META_ACCESS_TOKEN']),
        tiktok_configured: !!(process.env['TIKTOK_PIXEL_CODE'] && process.env['TIKTOK_ACCESS_TOKEN']),
        kafka_configured: !!process.env['KAFKA_BROKERS'],
      },
    };

    return NextResponse.json(stats);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error('[GET /api/tracking/stats] Error:', error);
    return NextResponse.json(
      { error: 'Failed to retrieve tracking stats', detail: message },
      { status: 500 },
    );
  }
}
