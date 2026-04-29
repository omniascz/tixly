import { NextRequest, NextResponse } from 'next/server';
import { getFraudStats } from '../../../../../../services/fraud-queue.service';
import { isFraudError } from '../../../../../../lib/fraud-errors';
import type { FraudDeps } from '../../../../../../services/fraud-queue.service';

function requireAdminUserId(request: NextRequest): string | null {
  return request.headers.get('x-admin-user-id');
}

// ---------------------------------------------------------------------------
// GET /api/platform/admin/fraud/stats
//
// Agregované statistiky fraud fronty pro admin dashboard widget.
//
// Response (200):
// {
//   "pendingReview": 7,
//   "resolvedToday": 12,
//   "confirmedFraudToday": 3,
//   "clearedToday": 9,
//   "avgRiskScore": 72.4,
//   "totalHeldHellers": 1250000   // hodnota objednávek aktuálně v hold
// }
// ---------------------------------------------------------------------------
export async function GET(
  request: NextRequest,
  context?: { deps?: FraudDeps },
): Promise<NextResponse> {
  const deps = context?.deps ?? getProductionDeps();

  if (!requireAdminUserId(request)) {
    return NextResponse.json(
      { error: 'UNAUTHORIZED', message: 'Admin authentication required' },
      { status: 401 },
    );
  }

  try {
    const stats = await getFraudStats(deps);
    return NextResponse.json(stats, {
      status: 200,
      headers: {
        'Cache-Control': 'private, max-age=30',
      },
    });
  } catch (err) {
    if (isFraudError(err)) {
      return NextResponse.json(err.toHttpError(), { status: err.statusCode });
    }
    throw err;
  }
}

function getProductionDeps(): FraudDeps {
  throw new Error('Production dependencies not configured. Use dependency injection.');
}
