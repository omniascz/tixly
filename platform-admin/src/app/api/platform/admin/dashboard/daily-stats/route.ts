import { NextRequest, NextResponse } from 'next/server';
import { getDailyStats } from '../../../../../../services/admin.service';
import { isAdminError } from '../../../../../../lib/admin-errors';
import { DailyStatsQuerySchema } from '../../../../../../lib/zod-schemas';
import type { ServiceDeps } from '../../../../../../lib/service-container';

declare const getDeps: () => ServiceDeps;

export async function GET(req: NextRequest): Promise<NextResponse> {
  const adminUserId = req.headers.get('x-admin-user-id');
  if (!adminUserId) {
    return NextResponse.json({ error: 'Missing x-admin-user-id header', code: 'UNAUTHORIZED' }, { status: 401 });
  }

  const parsed = DailyStatsQuerySchema.safeParse(
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
    const stats = await getDailyStats(parsed.data.days, deps);
    return NextResponse.json(stats, { status: 200 });
  } catch (err) {
    if (isAdminError(err)) {
      return NextResponse.json(err.toHttpError(), { status: err.statusCode });
    }
    console.error('[dashboard/daily-stats] Unexpected error:', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
