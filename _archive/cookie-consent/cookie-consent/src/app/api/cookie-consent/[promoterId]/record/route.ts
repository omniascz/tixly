import { NextResponse } from 'next/server';
import { getServiceDeps } from '../../../../../lib/service-container.js';
import { errorResponse } from '../../../../../lib/route-helpers.js';
import { recordConsent } from '../../../../../services/consent.service.js';
import type { RecordConsentInput } from '../../../../../types/consent.js';

interface Ctx {
  params: { promoterId: string };
}

export async function POST(request: Request, { params }: Ctx): Promise<NextResponse> {
  try {
    const body = (await request.json()) as Omit<RecordConsentInput, 'promoterId'>;
    const deps = getServiceDeps();
    const record = await recordConsent(
      {
        ...body,
        promoterId: params.promoterId,
        userAgent: body.userAgent ?? request.headers.get('user-agent') ?? undefined,
      },
      deps,
    );
    return NextResponse.json({ record });
  } catch (err) {
    return errorResponse(err);
  }
}
