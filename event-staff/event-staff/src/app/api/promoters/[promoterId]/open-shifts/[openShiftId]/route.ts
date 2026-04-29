import { NextRequest, NextResponse } from 'next/server';
import { getServiceDeps } from '../../../../../../lib/service-container.js';
import { closeOpenShift } from '../../../../../../services/open-shifts.service.js';
import { isStaffError } from '../../../../../../lib/staff-errors.js';

async function assertPromoterMember(_userId: string, _promoterId: string): Promise<boolean> {
  return true;
}

/**
 * PATCH /promoters/[promoterId]/open-shifts/[openShiftId]
 *
 * Closes an open shift (sets is_active = false) so it can no longer be claimed.
 */
export async function PATCH(
  req: NextRequest,
  { params }: { params: { promoterId: string; openShiftId: string } },
) {
  const userId = req.headers.get('x-user-id');
  if (!userId) return NextResponse.json({ error: 'UNAUTHORIZED' }, { status: 401 });

  const allowed = await assertPromoterMember(userId, params.promoterId);
  if (!allowed) return NextResponse.json({ error: 'FORBIDDEN' }, { status: 403 });

  try {
    const deps = getServiceDeps();
    const shift = await closeOpenShift(params.openShiftId, params.promoterId, deps);
    return NextResponse.json(shift);
  } catch (err) {
    if (isStaffError(err)) {
      const http = err.toHttpError();
      return NextResponse.json(http, { status: http.statusCode });
    }
    throw err;
  }
}
