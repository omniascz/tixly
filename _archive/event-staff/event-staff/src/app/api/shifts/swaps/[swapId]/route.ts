import { NextRequest, NextResponse } from 'next/server';
import { getServiceDeps } from '../../../../../lib/service-container.js';
import { cancelSwapRequest } from '../../../../../services/swap.service.js';
import { isStaffError } from '../../../../../lib/staff-errors.js';

/**
 * DELETE /shifts/swaps/[swapId]
 * Header: x-staff-id (must be the original requester)
 *
 * Cancels an open or pending_approval swap request.
 */
export async function DELETE(
  req: NextRequest,
  { params }: { params: { swapId: string } },
) {
  const userId = req.headers.get('x-user-id');
  const staffId = req.headers.get('x-staff-id');
  const promoterId = req.headers.get('x-promoter-id');

  if (!userId || !staffId || !promoterId) {
    return NextResponse.json({ error: 'UNAUTHORIZED' }, { status: 401 });
  }

  try {
    const deps = getServiceDeps();
    await cancelSwapRequest(params.swapId, staffId, promoterId, deps);
    return new NextResponse(null, { status: 204 });
  } catch (err) {
    if (isStaffError(err)) {
      const http = err.toHttpError();
      return NextResponse.json(http, { status: http.statusCode });
    }
    throw err;
  }
}
