import { NextResponse } from 'next/server';
import { getServiceDeps } from '../../../../../../../lib/service-container.js';
import {
  assertPromoterMembership,
  errorResponse,
  requireUserId,
} from '../../../../../../../lib/route-helpers.js';
import { deleteBlock } from '../../../../../../../services/landing-page.service.js';

export async function DELETE(
  request: Request,
  { params }: { params: { promoterId: string; blockId: string } },
) {
  try {
    const userId = requireUserId(request);
    await assertPromoterMembership(userId, params.promoterId);
    await deleteBlock(params.blockId, params.promoterId, getServiceDeps());
    return new NextResponse(null, { status: 204 });
  } catch (err) {
    return errorResponse(err);
  }
}
