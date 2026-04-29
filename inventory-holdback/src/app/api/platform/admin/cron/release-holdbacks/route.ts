import { NextRequest, NextResponse } from 'next/server';
import { HoldbackService } from '../../../../../../services/holdback.service.js';
import type { HoldbackDbAdapter } from '../../../../../../services/holdback.service.js';

// ---------------------------------------------------------------------------
// DB adapter factory
// ---------------------------------------------------------------------------

function getDbAdapter(): HoldbackDbAdapter {
  throw new Error('DB adapter not configured — wire up via getServiceContainer()');
}

// ---------------------------------------------------------------------------
// POST /api/platform/admin/cron/release-holdbacks
// Cron job endpoint — processes scheduled and trigger-based holdback releases.
//
// Auth: Should be protected via API key or internal service auth (not implemented here).
// Returns: { released: number, errors: number }
// ---------------------------------------------------------------------------

export async function POST(request: NextRequest): Promise<NextResponse> {
  // In production, verify that this request came from your cron scheduler
  // (e.g., check an Authorization header with a shared secret or API key).
  // For now, this is a stub — integrate with your auth middleware.

  try {
    const service = new HoldbackService(getDbAdapter());
    const { released, errors } = await service.processScheduledReleases();

    const statusCode = errors > 0 ? 207 : 200;
    return NextResponse.json(
      {
        success: true,
        released,
        errors,
      },
      { status: statusCode },
    );
  } catch (err) {
    console.error('[cron/release-holdbacks] Fatal error:', err);
    return NextResponse.json(
      {
        success: false,
        error: 'Failed to process holdback releases',
        details: err instanceof Error ? err.message : String(err),
      },
      { status: 500 },
    );
  }
}
