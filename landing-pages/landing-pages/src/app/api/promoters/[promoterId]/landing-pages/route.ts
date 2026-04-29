import { NextResponse } from 'next/server';
import { getServiceDeps } from '../../../../../lib/service-container.js';
import {
  assertPromoterMembership,
  errorResponse,
  requireUserId,
} from '../../../../../lib/route-helpers.js';
import {
  createPage,
  listPages,
} from '../../../../../services/landing-page.service.js';
import type { CreatePageInput, PageStatus } from '../../../../../types/landing.js';

export async function GET(
  request: Request,
  { params }: { params: { promoterId: string } },
) {
  try {
    const userId = requireUserId(request);
    await assertPromoterMembership(userId, params.promoterId);

    const url = new URL(request.url);
    const status = url.searchParams.get('status') as PageStatus | null;
    const pages = await listPages(
      params.promoterId,
      status ? { status } : {},
      getServiceDeps(),
    );
    return NextResponse.json({ pages });
  } catch (err) {
    return errorResponse(err);
  }
}

export async function POST(
  request: Request,
  { params }: { params: { promoterId: string } },
) {
  try {
    const userId = requireUserId(request);
    await assertPromoterMembership(userId, params.promoterId);

    const body = (await request.json()) as CreatePageInput;
    const page = await createPage(params.promoterId, body, getServiceDeps());
    return NextResponse.json({ page }, { status: 201 });
  } catch (err) {
    return errorResponse(err);
  }
}
