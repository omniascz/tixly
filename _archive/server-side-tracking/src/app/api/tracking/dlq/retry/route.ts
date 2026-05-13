import { NextRequest, NextResponse } from 'next/server';
import type { ServiceDeps } from '../../../../../types/tracking.types.js';
import { runDlqRetry } from '../../../../../jobs/dlq-retry.job.js';

/**
 * POST /api/tracking/dlq/retry
 * Manually trigger DLQ retry for failed tracking events.
 * Requires INTERNAL_API_KEY header for authentication.
 */
export async function POST(request: NextRequest): Promise<NextResponse> {
  try {
    const apiKey = request.headers.get('x-api-key');
    const expectedKey = process.env['INTERNAL_API_KEY'];

    if (!expectedKey || apiKey !== expectedKey) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // TODO: Inject ServiceDeps from application context
    const deps: ServiceDeps = null as unknown as ServiceDeps;

    const result = await runDlqRetry(deps);

    return NextResponse.json(
      {
        message: 'DLQ retry completed',
        total: result.total,
        succeeded: result.succeeded,
        failed: result.failed,
      },
      { status: 200 },
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error('[POST /api/tracking/dlq/retry] Error:', error);
    return NextResponse.json(
      { error: 'DLQ retry failed', detail: message },
      { status: 500 },
    );
  }
}
