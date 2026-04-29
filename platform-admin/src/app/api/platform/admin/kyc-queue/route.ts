import { NextRequest, NextResponse } from 'next/server';
import { getKycQueue, getKycStats } from '../../../../../services/admin.service';
import { isAdminError } from '../../../../../lib/admin-errors';
import { KycQueueQuerySchema } from '../../../../../lib/zod-schemas';
import type { ServiceDeps } from '../../../../../lib/service-container';

declare const getDeps: () => ServiceDeps;

export async function GET(req: NextRequest): Promise<NextResponse> {
  const adminUserId = req.headers.get('x-admin-user-id');
  if (!adminUserId) {
    return NextResponse.json({ error: 'Missing x-admin-user-id header', code: 'UNAUTHORIZED' }, { status: 401 });
  }

  const parsed = KycQueueQuerySchema.safeParse(
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
    const [queueResult, stats] = await Promise.all([
      getKycQueue(parsed.data, deps),
      getKycStats(deps),
    ]);

    return NextResponse.json(
      { ...queueResult, stats },
      { status: 200 },
    );
  } catch (err) {
    if (isAdminError(err)) {
      return NextResponse.json(err.toHttpError(), { status: err.statusCode });
    }
    console.error('[kyc-queue] Unexpected error:', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
