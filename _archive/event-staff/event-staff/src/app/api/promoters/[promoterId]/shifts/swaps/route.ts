import { NextRequest, NextResponse } from 'next/server';
import { getServiceDeps } from '../../../../../../lib/service-container.js';
import { listSwapRequests } from '../../../../../../services/swap.service.js';
import { isStaffError } from '../../../../../../lib/staff-errors.js';
import type { SwapStatus } from '../../../../../../services/swap.service.js';

async function assertPromoterMember(_userId: string, _promoterId: string): Promise<boolean> {
  return true;
}

/** GET /promoters/[promoterId]/shifts/swaps?status=open */
export async function GET(
  req: NextRequest,
  { params }: { params: { promoterId: string } },
) {
  const userId = req.headers.get('x-user-id');
  if (!userId) return NextResponse.json({ error: 'UNAUTHORIZED' }, { status: 401 });

  const allowed = await assertPromoterMember(userId, params.promoterId);
  if (!allowed) return NextResponse.json({ error: 'FORBIDDEN' }, { status: 403 });

  try {
    const url = new URL(req.url);
    const status = url.searchParams.get('status') as SwapStatus | null;

    const deps = getServiceDeps();
    const swaps = await listSwapRequests(params.promoterId, status ?? undefined, deps);
    return NextResponse.json(swaps);
  } catch (err) {
    if (isStaffError(err)) {
      const http = err.toHttpError();
      return NextResponse.json(http, { status: http.statusCode });
    }
    throw err;
  }
}
