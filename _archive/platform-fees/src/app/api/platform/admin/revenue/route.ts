import { NextRequest, NextResponse } from 'next/server';
import { RevenueSummaryFiltersSchema } from '../../../../../lib/zod-schemas';
import { getPlatformRevenueSummary } from '../../../../../services/fee.service';
import { FeeError } from '../../../../../lib/fee-errors';
import type { ServiceDeps } from '../../../../../lib/service-container';

// ---------------------------------------------------------------------------
// Deps factory — přepsatelná v testech
// ---------------------------------------------------------------------------
export let _getDeps: () => ServiceDeps = () => {
  throw new Error('DB adapter not configured — inject via _getDeps');
};

export function _setDeps(factory: () => ServiceDeps): void {
  _getDeps = factory;
}

// ---------------------------------------------------------------------------
// GET /api/platform/admin/revenue?from=...&to=...&promoterId=...
// ---------------------------------------------------------------------------
export async function GET(request: NextRequest): Promise<NextResponse> {
  const adminUserId = request.headers.get('x-admin-user-id');
  if (!adminUserId) {
    return NextResponse.json({ error: { code: 'UNAUTHORIZED', message: 'Chybí x-admin-user-id header.' } }, { status: 401 });
  }

  const { searchParams } = new URL(request.url);

  const rawFilters = {
    from: searchParams.get('from') ?? undefined,
    to: searchParams.get('to') ?? undefined,
    promoterId: searchParams.get('promoterId') ?? undefined,
  };

  const parseResult = RevenueSummaryFiltersSchema.safeParse(rawFilters);
  if (!parseResult.success) {
    return NextResponse.json(
      { error: { code: 'VALIDATION_ERROR', message: parseResult.error.errors[0]?.message ?? 'Neplatné filtry.' } },
      { status: 400 },
    );
  }

  try {
    const rows = await getPlatformRevenueSummary(parseResult.data, _getDeps());
    return NextResponse.json(rows, { status: 200 });
  } catch (err) {
    if (err instanceof FeeError) {
      return NextResponse.json(err.toHttpError(), { status: err.statusCode });
    }
    throw err;
  }
}
