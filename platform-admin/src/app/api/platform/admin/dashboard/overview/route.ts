import { NextRequest, NextResponse } from 'next/server';
import { getPlatformOverview } from '../../../../../../services/admin.service';
import { isAdminError } from '../../../../../../lib/admin-errors';
import type { ServiceDeps } from '../../../../../../lib/service-container';

declare const getDeps: () => ServiceDeps;

export async function GET(req: NextRequest): Promise<NextResponse> {
  const adminUserId = req.headers.get('x-admin-user-id');
  if (!adminUserId) {
    return NextResponse.json({ error: 'Missing x-admin-user-id header', code: 'UNAUTHORIZED' }, { status: 401 });
  }

  try {
    const deps = getDeps();
    const overview = await getPlatformOverview(deps);
    return NextResponse.json(overview, { status: 200 });
  } catch (err) {
    if (isAdminError(err)) {
      return NextResponse.json(err.toHttpError(), { status: err.statusCode });
    }
    console.error('[dashboard/overview] Unexpected error:', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
