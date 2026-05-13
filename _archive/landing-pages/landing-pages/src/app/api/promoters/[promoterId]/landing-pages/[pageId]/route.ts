import { NextResponse } from 'next/server';
import { getServiceDeps } from '../../../../../../lib/service-container.js';
import {
  assertPromoterMembership,
  errorResponse,
  requireUserId,
} from '../../../../../../lib/route-helpers.js';
import {
  deletePage,
  getPageById,
  updatePage,
} from '../../../../../../services/landing-page.service.js';
import type { UpdatePageInput } from '../../../../../../types/landing.js';

export async function GET(
  request: Request,
  { params }: { params: { promoterId: string; pageId: string } },
) {
  try {
    const userId = requireUserId(request);
    await assertPromoterMembership(userId, params.promoterId);
    const page = await getPageById(
      params.pageId,
      params.promoterId,
      getServiceDeps(),
    );
    return NextResponse.json({ page });
  } catch (err) {
    return errorResponse(err);
  }
}

export async function PATCH(
  request: Request,
  { params }: { params: { promoterId: string; pageId: string } },
) {
  try {
    const userId = requireUserId(request);
    await assertPromoterMembership(userId, params.promoterId);
    const body = (await request.json()) as UpdatePageInput;
    const page = await updatePage(
      params.pageId,
      params.promoterId,
      body,
      getServiceDeps(),
    );
    return NextResponse.json({ page });
  } catch (err) {
    return errorResponse(err);
  }
}

export async function DELETE(
  request: Request,
  { params }: { params: { promoterId: string; pageId: string } },
) {
  try {
    const userId = requireUserId(request);
    await assertPromoterMembership(userId, params.promoterId);
    await deletePage(params.pageId, params.promoterId, getServiceDeps());
    return new NextResponse(null, { status: 204 });
  } catch (err) {
    return errorResponse(err);
  }
}
