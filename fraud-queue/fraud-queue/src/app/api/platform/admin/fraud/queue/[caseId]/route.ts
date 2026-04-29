import { NextRequest, NextResponse } from 'next/server';
import { getFraudCase } from '../../../../../../../services/fraud-queue.service';
import { isFraudError } from '../../../../../../../lib/fraud-errors';
import type { FraudDeps } from '../../../../../../../services/fraud-queue.service';

function requireAdminUserId(request: NextRequest): string | null {
  return request.headers.get('x-admin-user-id');
}

// ---------------------------------------------------------------------------
// GET /api/platform/admin/fraud/queue/:caseId
//
// Detail jednoho fraud případu včetně všech review kroků.
//
// Response (200): FraudCaseDetail
// ---------------------------------------------------------------------------
export async function GET(
  request: NextRequest,
  { params, deps }: { params: { caseId: string }; deps?: FraudDeps },
): Promise<NextResponse> {
  const resolvedDeps = deps ?? getProductionDeps();

  if (!requireAdminUserId(request)) {
    return NextResponse.json(
      { error: 'UNAUTHORIZED', message: 'Admin authentication required' },
      { status: 401 },
    );
  }

  try {
    const caseDetail = await getFraudCase(params.caseId, resolvedDeps);
    return NextResponse.json(caseDetail, { status: 200 });
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
