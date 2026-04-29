import { NextRequest, NextResponse } from 'next/server';
import { getServiceDeps } from '../../../../../../lib/service-container.js';
import {
  BuyerPortalError,
  isBuyerPortalError,
} from '../../../../../../lib/buyer-portal-errors.js';
import { getBuyerOrderDetail } from '../../../../../../services/buyer-portal.service.js';

export async function GET(
  req: NextRequest,
  ctx: { params: { orderId: string } },
): Promise<NextResponse> {
  try {
    const userId = req.headers.get('x-user-id');
    if (!userId) {
      throw new BuyerPortalError('UNAUTHORIZED');
    }

    const deps = getServiceDeps();
    const detail = await getBuyerOrderDetail(ctx.params.orderId, userId, deps);
    return NextResponse.json(detail);
  } catch (err) {
    if (isBuyerPortalError(err)) {
      return NextResponse.json(err.toHttpError(), { status: err.statusCode });
    }
    return NextResponse.json(
      { error: 'INTERNAL_ERROR', message: 'Internal server error' },
      { status: 500 },
    );
  }
}
