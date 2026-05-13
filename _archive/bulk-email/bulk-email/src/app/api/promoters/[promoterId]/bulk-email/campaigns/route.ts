import { NextRequest, NextResponse } from 'next/server';
import {
  createCampaign,
  listCampaigns,
} from '../../../../../../../services/bulk-email.service.js';
import { isBulkEmailError } from '../../../../../../../lib/bulk-email-errors.js';
import type { ServiceDeps } from '../../../../../../../lib/service-container.js';
import { getServiceDeps } from '../../../../../../../lib/service-container.js';

function requirePromoterAuth(request: NextRequest, promoterId: string): string | null {
  const userId = request.headers.get('x-user-id');
  const authPromoterId = request.headers.get('x-promoter-id');
  if (!userId || authPromoterId !== promoterId) return null;
  return userId;
}

export async function GET(
  request: NextRequest,
  context: { params: { promoterId: string }; deps?: ServiceDeps },
): Promise<NextResponse> {
  const deps = context.deps ?? getServiceDeps();
  if (!requirePromoterAuth(request, context.params.promoterId)) {
    return NextResponse.json({ error: 'UNAUTHORIZED' }, { status: 401 });
  }
  const url = new URL(request.url);
  const limit = parseInt(url.searchParams.get('limit') ?? '50', 10);
  const offset = parseInt(url.searchParams.get('offset') ?? '0', 10);
  try {
    const result = await listCampaigns(context.params.promoterId, { limit, offset }, deps);
    return NextResponse.json(result, { status: 200 });
  } catch (err) {
    if (isBulkEmailError(err)) {
      return NextResponse.json(err.toHttpError(), { status: err.statusCode });
    }
    throw err;
  }
}

export async function POST(
  request: NextRequest,
  context: { params: { promoterId: string }; deps?: ServiceDeps },
): Promise<NextResponse> {
  const deps = context.deps ?? getServiceDeps();
  const userId = requirePromoterAuth(request, context.params.promoterId);
  if (!userId) return NextResponse.json({ error: 'UNAUTHORIZED' }, { status: 401 });

  try {
    const body = await request.json();
    const campaign = await createCampaign(
      {
        promoterId: context.params.promoterId,
        name: body.name,
        subject: body.subject,
        htmlBody: body.htmlBody,
        segment: body.segment,
      },
      userId,
      deps,
    );
    return NextResponse.json(campaign, { status: 201 });
  } catch (err) {
    if (isBulkEmailError(err)) {
      return NextResponse.json(err.toHttpError(), { status: err.statusCode });
    }
    throw err;
  }
}
