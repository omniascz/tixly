import { NextRequest, NextResponse } from 'next/server';
import { getOverdueCases } from '../../../../../../services/fraud-queue.service';
import { isFraudError } from '../../../../../../lib/fraud-errors';
import type { FraudDeps } from '../../../../../../services/fraud-queue.service';

function requireAdminUserId(request: NextRequest): string | null {
  return request.headers.get('x-admin-user-id');
}

// ---------------------------------------------------------------------------
// GET /api/platform/admin/fraud/overdue
//
// Dashboard widget — fraud cases past SLA deadline (pending/reviewing only).
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
    const items = await getOverdueCases(deps);
    return NextResponse.json({ items, total: items.length }, {
      status: 200,
      headers: { 'Cache-Control': 'private, max-age=15' },
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
