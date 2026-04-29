import { NextRequest, NextResponse } from 'next/server';
import { releaseMaturedReserves } from '../../../../../../services/payout.service.js';
import { PayoutError } from '../../../../../../lib/payout-errors.js';
import type { ServiceDeps } from '../../../../../../lib/service-container.js';
import { getServiceDeps } from '../../../../../../lib/service-container.js';

export async function POST(
  _request: NextRequest
): Promise<NextResponse> {
  try {
    const deps = getServiceDeps();
    const result = await releaseMaturedReserves(deps);
    return NextResponse.json(result, { status: 200 });
  } catch (err) {
    if (err instanceof PayoutError) {
      const { error, statusCode } = err.toHttpError();
      return NextResponse.json({ error }, { status: statusCode });
    }
    return NextResponse.json(
      { error: { code: 'INTERNAL_ERROR', message: 'Interní chyba serveru.' } },
      { status: 500 }
    );
  }
}
