import { NextRequest, NextResponse } from 'next/server';
import { claimCase } from '../../../../../../../../services/fraud-queue.service';
import { isFraudError } from '../../../../../../../../lib/fraud-errors';
import type { FraudDeps } from '../../../../../../../../services/fraud-queue.service';

function requireAdminUserId(request: NextRequest): string | null {
  return request.headers.get('x-admin-user-id');
}

// ---------------------------------------------------------------------------
// POST /api/platform/admin/fraud/queue/:caseId/claim
//
// CS agent claims a case to prevent double-review.
// Claim lock expires after 30 minutes of inactivity.
//
// Response: 204 No Content
// Errors:
//   401 UNAUTHORIZED
//   404 CASE_NOT_FOUND
//   409 CASE_ALREADY_CLAIMED — claimed by a different CS agent within lock window
//   409 CASE_ALREADY_RESOLVED
// ---------------------------------------------------------------------------
export async function POST(
  request: NextRequest,
  { params, deps }: { params: { caseId: string }; deps?: FraudDeps },
): Promise<NextResponse> {
  const resolvedDeps = deps ?? getProductionDeps();

  const csUserId = requireAdminUserId(request);
  if (!csUserId) {
    return NextResponse.json(
      { error: 'UNAUTHORIZED', message: 'Admin authentication required' },
      { status: 401 },
    );
  }

  try {
    await claimCase(params.caseId, csUserId, resolvedDeps);
    return new NextResponse(null, { status: 204 });
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
