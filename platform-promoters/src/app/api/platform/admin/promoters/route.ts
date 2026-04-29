import { NextRequest, NextResponse } from 'next/server';
import { listPromoters } from '../../../../../services/promoter.service.js';
import { isPlatformError } from '../../../../../lib/platform-errors.js';
import { PromoterFiltersSchema } from '../../../../../lib/zod-schemas.js';
import type { ServiceDeps } from '../../../../../lib/service-container.js';

function getDeps(): ServiceDeps {
  throw new Error('ServiceDeps must be injected at runtime');
}

export async function GET(req: NextRequest): Promise<NextResponse> {
  const adminUserId = req.headers.get('x-admin-user-id');
  if (!adminUserId) {
    return NextResponse.json({ error: 'Missing x-admin-user-id header' }, { status: 401 });
  }

  const searchParams = req.nextUrl.searchParams;
  const rawFilters = {
    status: searchParams.get('status') ?? undefined,
    kyc_status: searchParams.get('kyc_status') ?? undefined,
    search: searchParams.get('search') ?? undefined,
    limit: searchParams.get('limit') ?? undefined,
    offset: searchParams.get('offset') ?? undefined,
  };

  const parsed = PromoterFiltersSchema.safeParse(rawFilters);
  if (!parsed.success) {
    return NextResponse.json({ error: 'Invalid query params', details: parsed.error.issues }, { status: 422 });
  }

  try {
    const deps = getDeps();
    const result = await listPromoters(parsed.data, deps);
    return NextResponse.json(result);
  } catch (err) {
    if (isPlatformError(err)) {
      return NextResponse.json(err.toHttpError(), { status: err.statusCode });
    }
    throw err;
  }
}
