import { NextRequest, NextResponse } from 'next/server';
import { bulkUpdatePromoterStatus } from '../../../../../../services/admin.service';
import { isAdminError } from '../../../../../../lib/admin-errors';
import { BulkActionBodySchema } from '../../../../../../lib/zod-schemas';
import type { ServiceDeps } from '../../../../../../lib/service-container';

declare const getDeps: () => ServiceDeps;

export async function POST(req: NextRequest): Promise<NextResponse> {
  const adminUserId = req.headers.get('x-admin-user-id');
  if (!adminUserId) {
    return NextResponse.json({ error: 'Missing x-admin-user-id header', code: 'UNAUTHORIZED' }, { status: 401 });
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const parsed = BulkActionBodySchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'Validation failed', issues: parsed.error.issues },
      { status: 400 },
    );
  }

  const { promoterIds, action, reason } = parsed.data;

  try {
    const deps = getDeps();
    const result = await bulkUpdatePromoterStatus(promoterIds, action, reason, adminUserId, deps);
    const hasFailures = result.failed.length > 0;
    return NextResponse.json(result, { status: hasFailures ? 207 : 200 });
  } catch (err) {
    if (isAdminError(err)) {
      return NextResponse.json(err.toHttpError(), { status: err.statusCode });
    }
    console.error('[promoters/bulk-action] Unexpected error:', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
