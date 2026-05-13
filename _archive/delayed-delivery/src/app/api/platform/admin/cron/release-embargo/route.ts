import { NextRequest, NextResponse } from 'next/server';
import { DelayedDeliveryService } from '../../../../../../services/delayed-delivery.service';

// ---------------------------------------------------------------------------
// POST /api/platform/admin/cron/release-embargo
// ---------------------------------------------------------------------------
// Cron endpoint — releases all embargoed tickets whose embargo has expired.
// Can be called by external cron service (e.g., CloudScheduler, GitHub Actions).
// Requires platform-level API key via x-api-key header or similar auth.
//
// Returns:
//   { released: number }
//
// This endpoint is typically called every 15 minutes alongside processDueDeliveries.

export async function POST(request: NextRequest): Promise<NextResponse> {
  // --- Platform auth — adjust based on your auth strategy ---
  const apiKey = request.headers.get('x-api-key');
  const expectedKey = process.env.PLATFORM_CRON_API_KEY;

  if (!expectedKey) {
    console.warn('[release-embargo] PLATFORM_CRON_API_KEY not configured');
    return NextResponse.json(
      { error: 'Internal server error', code: 'INTERNAL_ERROR' },
      { status: 500 },
    );
  }

  if (!apiKey || apiKey !== expectedKey) {
    return NextResponse.json(
      { error: 'Unauthorized', code: 'UNAUTHORIZED' },
      { status: 401 },
    );
  }

  try {
    const { getDeliveryDbAdapter } = await import('../../../../../../lib/delivery-db-adapter');
    const { getKafkaProducer } = await import('../../../../../../lib/kafka-producer');

    const db = getDeliveryDbAdapter();
    const kafka = getKafkaProducer();
    const service = new DelayedDeliveryService();

    const result = await service.releaseExpiredEmbargoes(db, kafka);

    console.info(
      `[release-embargo] Cron run complete — released ${result.released} tickets`,
    );

    return NextResponse.json(result, {
      status: 200,
      headers: { 'Cache-Control': 'no-store' },
    });
  } catch (err) {
    console.error('[release-embargo] Cron job failed:', err);
    return NextResponse.json(
      { error: 'Internal server error', code: 'INTERNAL_ERROR' },
      { status: 500 },
    );
  }
}
