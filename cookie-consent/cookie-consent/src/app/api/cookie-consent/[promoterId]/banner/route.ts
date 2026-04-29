import { NextResponse } from 'next/server';
import { getServiceDeps } from '../../../../../lib/service-container.js';
import { errorResponse } from '../../../../../lib/route-helpers.js';
import { getBannerConfig } from '../../../../../services/consent.service.js';

interface Ctx {
  params: { promoterId: string };
}

export async function GET(_request: Request, { params }: Ctx): Promise<NextResponse> {
  try {
    const deps = getServiceDeps();
    const config = await getBannerConfig(params.promoterId, deps);
    return NextResponse.json({ config });
  } catch (err) {
    return errorResponse(err);
  }
}
