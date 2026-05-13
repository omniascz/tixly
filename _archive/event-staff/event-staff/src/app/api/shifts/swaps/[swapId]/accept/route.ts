import { NextRequest, NextResponse } from 'next/server';
import { getServiceDeps } from '../../../../../../lib/service-container.js';
import { acceptSwap } from '../../../../../../services/swap.service.js';
import { acceptSwapSchema } from '../../../../../../lib/zod-schemas.js';
import { isStaffError } from '../../../../../../lib/staff-errors.js';

/**
 * POST /shifts/swaps/[swapId]/accept
 * Body: { accepterStaffId: string }
 *
 * Staff member accepts an open swap request. Moves it to pending_approval.
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
    const body = await req.json();
    const parsed = acceptSwapSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: 'VALIDATION_ERROR', issues: parsed.error.issues },
        { status: 400 },
      );
    }

    const deps = getServiceDeps();
    const swap = await acceptSwap(params.swapId, parsed.data.accepterStaffId, promoterId, deps);
    return NextResponse.json(swap);
  } catch (err) {
    if (isStaffError(err)) {
      const http = err.toHttpError();
      return NextResponse.json(http, { status: http.statusCode });
    }
    throw err;
  }
}
