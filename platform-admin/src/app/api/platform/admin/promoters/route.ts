import { NextRequest, NextResponse } from 'next/server';
import { listPromoters } from '../../../../../services/admin.service';
import { isAdminError } from '../../../../../lib/admin-errors';
import { PromoterFiltersSchema } from '../../../../../lib/zod-schemas';
import type { ServiceDeps } from '../../../../../lib/service-container';

declare const getDeps: () => ServiceDeps;

export async function GET(req: NextRequest): Promise<NextResponse> {
  const adminUserId = req.headers.get('x-admin-user-id');
  if (!adminUserId) {
    return NextResponse.json({ error: 'Missing x-admin-user-id header', code: 'UNAUTHORIZED' }, { status: 401 });
  }

  const parsed = PromoterFiltersSchema.safeParse(
    Object.fromEntries(req.nextUrl.searchParams.entries()),
  );
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'Invalid query parameters', issues: parsed.error.issues },
      { status: 400 },
    );
  }

  try {
    const deps = getDeps();
    const result = await listPromoters(parsed.data, deps);
    return NextResponse.json(result, { status: 200 });
  } catch (err) {
    if (isAdminError(err)) {
      return NextResponse.json(err.toHttpError(), { status: err.statusCode });
    }
    console.error('[promoters] Unexpected error:', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
