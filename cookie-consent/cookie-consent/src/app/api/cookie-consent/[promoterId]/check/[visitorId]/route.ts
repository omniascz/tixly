import { NextResponse } from 'next/server';
import { getServiceDeps } from '../../../../../../lib/service-container.js';
import { errorResponse } from '../../../../../../lib/route-helpers.js';
import { isConsentValid } from '../../../../../../services/consent.service.js';

interface Ctx {
  params: { promoterId: string; visitorId: string };
}

export async function GET(_request: Request, { params }: Ctx): Promise<NextResponse> {
  try {
    const deps = getServiceDeps();
    const valid = await isConsentValid(params.visitorId, params.promoterId, deps);
    return NextResponse.json({ valid });
  } catch (err) {
    return errorResponse(err);
  }
}
