import { NextResponse } from 'next/server';
import { getServiceDeps } from '../../../../../../lib/service-container.js';
import { errorResponse } from '../../../../../../lib/route-helpers.js';
import { setBannerConfig } from '../../../../../../services/consent.service.js';
import type { BannerConfig } from '../../../../../../types/consent.js';

interface Ctx {
  params: { promoterId: string };
}

export async function PUT(request: Request, { params }: Ctx): Promise<NextResponse> {
  try {
    const body = (await request.json()) as Partial<BannerConfig>;
    const deps = getServiceDeps();
    const config = await setBannerConfig(params.promoterId, body, deps);
    return NextResponse.json({ config });
  } catch (err) {
    return errorResponse(err);
  }
}
