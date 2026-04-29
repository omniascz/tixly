import { NextRequest, NextResponse } from 'next/server';
import { listFraudQueue } from '../../../../../../services/fraud-queue.service';
import { isFraudError } from '../../../../../../lib/fraud-errors';
import type { FraudDeps } from '../../../../../../services/fraud-queue.service';

function requireAdminUserId(request: NextRequest): string | null {
  return request.headers.get('x-admin-user-id');
}

// ---------------------------------------------------------------------------
// GET /api/platform/admin/fraud/queue
//
// Seznam podezřelých objednávek v frontě pro manuální review.
//
// Query params:
//   status    — pending_review (default) | cleared | confirmed_fraud | escalated
//   priority  — low | normal | high | critical
//   minScore  — minimum risk_score (0-100)
//   limit     — default 20, max 100
//   offset    — default 0
//
// Response (200):
// {
//   "items": [...],
//   "total": 12,
//   "limit": 20,
//   "offset": 0
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

  const sp = request.nextUrl.searchParams;

  const rawLimit = parseInt(sp.get('limit') ?? '20', 10);
  const limit = Number.isNaN(rawLimit) || rawLimit < 1 ? 20 : Math.min(rawLimit, 100);

  const rawOffset = parseInt(sp.get('offset') ?? '0', 10);
  const offset = Number.isNaN(rawOffset) || rawOffset < 0 ? 0 : rawOffset;

  const rawScore = sp.get('minScore');
  const minScore = rawScore !== null ? parseInt(rawScore, 10) : undefined;

  const filters = {
    status:   sp.get('status') ?? undefined,
    priority: sp.get('priority') ?? undefined,
    minScore: minScore !== undefined && !Number.isNaN(minScore) ? minScore : undefined,
    limit,
    offset,
  };

  try {
    const result = await listFraudQueue(filters, deps);
    return NextResponse.json({ ...result, limit, offset }, { status: 200 });
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
