import { NextRequest, NextResponse } from 'next/server';
import { previewSegment } from '../../../../../../../../../services/bulk-email.service.js';
import { isBulkEmailError } from '../../../../../../../../../lib/bulk-email-errors.js';
import type { ServiceDeps } from '../../../../../../../../../lib/service-container.js';
import { getServiceDeps } from '../../../../../../../../../lib/service-container.js';

function requirePromoterAuth(request: NextRequest, promoterId: string): boolean {
  return (
    request.headers.get('x-user-id') !== null &&
    request.headers.get('x-promoter-id') === promoterId
  );
}

export async function POST(
  request: NextRequest,
  context: { params: { promoterId: string; campaignId: string }; deps?: ServiceDeps },
): Promise<NextResponse> {
  const deps = context.deps ?? getServiceDeps();
  if (!requirePromoterAuth(request, context.params.promoterId)) {
    return NextResponse.json({ error: 'UNAUTHORIZED' }, { status: 401 });
  }
  try {
    const body = await request.json();
    const result = await previewSegment(context.params.promoterId, body.segment, deps);
    return NextResponse.json(result, { status: 200 });
  } catch (err) {
    if (isBulkEmailError(err)) {
      return NextResponse.json(err.toHttpError(), { status: err.statusCode });
    }
    throw err;
  }
}
