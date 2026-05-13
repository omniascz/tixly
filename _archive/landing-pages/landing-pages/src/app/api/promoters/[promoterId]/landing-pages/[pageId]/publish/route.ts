import { NextResponse } from 'next/server';
import { getServiceDeps } from '../../../../../../../lib/service-container.js';
import {
  assertPromoterMembership,
  errorResponse,
  requireUserId,
} from '../../../../../../../lib/route-helpers.js';
import { publishPage } from '../../../../../../../services/landing-page.service.js';

export async function POST(
  request: Request,
  { params }: { params: { promoterId: string; pageId: string } },
) {
  try {
    const userId = requireUserId(request);
    await assertPromoterMembership(userId, params.promoterId);
    const page = await publishPage(
      params.pageId,
      params.promoterId,
      getServiceDeps(),
    );
    return NextResponse.json({ page });
  } catch (err) {
    return errorResponse(err);
  }
}
