import { NextRequest, NextResponse } from 'next/server';
import { getServiceDeps } from '../../../../../../lib/service-container.js';
import { approveSwap } from '../../../../../../services/swap.service.js';
import { isStaffError } from '../../../../../../lib/staff-errors.js';

/**
 * POST /shifts/swaps/[swapId]/approve
 *
 * Promoter approves a pending swap. The shift is reassigned to the accepter.
 */
export async function POST(
  req: NextRequest,
  { params }: { params: { swapId: string } },
) {
  const userId = req.headers.get('x-user-id');
  const promoterId = req.headers.get('x-promoter-id');

  if (!userId || !promoterId) {
    return NextResponse.json({ error: 'UNAUTHORIZED' }, { status: 401 });
  }

  try {
    const deps = getServiceDeps();
    const swap = await approveSwap(params.swapId, promoterId, deps);
    return NextResponse.json(swap);
  } catch (err) {
    if (isStaffError(err)) {
      const http = err.toHttpError();
      return NextResponse.json(http, { status: http.statusCode });
    }
    throw err;
  }
}
