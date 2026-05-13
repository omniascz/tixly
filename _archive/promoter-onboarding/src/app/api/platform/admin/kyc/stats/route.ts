import { NextRequest, NextResponse } from 'next/server';
import { getKycQueueStats } from '../../../../../../services/kyc-admin.service';
import { isOnboardingError } from '../../../../../../lib/onboarding-errors';
import type { ServiceDeps } from '../../../../../../lib/service-container';
import { getServiceDeps } from '../../../../../../lib/service-container.js';

function requireAdminUserId(request: NextRequest): string | null {
  return request.headers.get('x-admin-user-id');
}

// ---------------------------------------------------------------------------
// GET /api/platform/admin/kyc/stats
//
// Statistiky KYC fronty pro dashboard.
//
// Response (200):
// {
//   "pending": 12,
//   "submittedToday": 3,
//   "approvedToday": 5,
//   "rejectedToday": 1,
//   "avgReviewHours": 4.2
// }
// ---------------------------------------------------------------------------
export async function GET(
  request: NextRequest,
  context?: { deps?: ServiceDeps },
): Promise<NextResponse> {
  const deps: ServiceDeps = context?.deps ?? getServiceDeps();

  if (!requireAdminUserId(request)) {
    return NextResponse.json(
      { error: 'UNAUTHORIZED', message: 'Admin authentication required' },
      { status: 401 },
    );
  }

  try {
    const stats = await getKycQueueStats(deps);
    return NextResponse.json(stats, {
      status: 200,
      headers: {
        // Stats se mění pomalu — 30s cache je OK
        'Cache-Control': 'private, max-age=30',
      },
    });
  } catch (err) {
    if (isOnboardingError(err)) {
      return NextResponse.json(err.toHttpError(), { status: err.statusCode });
    }
    throw err;
  }
}

