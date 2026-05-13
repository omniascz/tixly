import { NextResponse } from 'next/server';
import { getServiceDeps } from '../../../../../../../lib/service-container.js';
import {
  assertPromoterMembership,
  errorResponse,
  requireUserId,
} from '../../../../../../../lib/route-helpers.js';
import {
  setPageBlocks,
  upsertBlock,
} from '../../../../../../../services/landing-page.service.js';
import type { UpsertBlockInput } from '../../../../../../../types/landing.js';

export async function PUT(
  request: Request,
  { params }: { params: { promoterId: string; pageId: string } },
) {
  try {
    const userId = requireUserId(request);
    await assertPromoterMembership(userId, params.promoterId);
    const body = (await request.json()) as { blocks: UpsertBlockInput[] };
    const blocks = await setPageBlocks(
      params.pageId,
      params.promoterId,
      body.blocks ?? [],
      getServiceDeps(),
    );
    return NextResponse.json({ blocks });
  } catch (err) {
    return errorResponse(err);
  }
}

export async function POST(
  request: Request,
  { params }: { params: { promoterId: string; pageId: string } },
) {
  try {
    const userId = requireUserId(request);
    await assertPromoterMembership(userId, params.promoterId);
    const body = (await request.json()) as UpsertBlockInput & { id?: string };
    const { id, ...input } = body;
    const block = await upsertBlock(
      params.pageId,
      params.promoterId,
      id ?? null,
      input,
      getServiceDeps(),
    );
    return NextResponse.json({ block });
  } catch (err) {
    return errorResponse(err);
  }
}
