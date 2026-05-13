import { NextRequest, NextResponse } from 'next/server';
import { searchPromoters } from '../../../../../services/kyc-admin.service';
import { isOnboardingError } from '../../../../../lib/onboarding-errors';
import type { ServiceDeps } from '../../../../../lib/service-container';
import { getServiceDeps } from '../../../../../lib/service-container.js';

function requireAdminUserId(request: NextRequest): string | null {
  return request.headers.get('x-admin-user-id');
}

// ---------------------------------------------------------------------------
// GET /api/platform/admin/promoters
//
// Vyhledávání a filtrování promotérů pro admin dashboard.
//
// Query params:
//   q          — fulltext přes name, legalName, IČO
//   status     — pending | active | suspended | banned
//   kycStatus  — not_started | submitted | verified | rejected
//   from       — ISO8601 datum (created_at >=)
//   to         — ISO8601 datum (created_at <=)
//   limit      — default 20, max 100
//   offset     — default 0
//
// Response (200):
// {
//   "items": [...],
//   "total": 42,
//   "limit": 20,
//   "offset": 0
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

  const sp = request.nextUrl.searchParams;

  const rawLimit = parseInt(sp.get('limit') ?? '20', 10);
  const limit = Number.isNaN(rawLimit) || rawLimit < 1 ? 20 : Math.min(rawLimit, 100);

  const rawOffset = parseInt(sp.get('offset') ?? '0', 10);
  const offset = Number.isNaN(rawOffset) || rawOffset < 0 ? 0 : rawOffset;

  const filters = {
    query:     sp.get('q') ?? undefined,
    status:    sp.get('status') ?? undefined,
    kycStatus: sp.get('kycStatus') ?? undefined,
    from:      sp.get('from') ?? undefined,
    to:        sp.get('to') ?? undefined,
    limit,
    offset,
  };

  try {
    const result = await searchPromoters(filters, deps);
    return NextResponse.json({ ...result, limit, offset }, { status: 200 });
  } catch (err) {
    if (isOnboardingError(err)) {
      return NextResponse.json(err.toHttpError(), { status: err.statusCode });
    }
    throw err;
  }
}

