import { NextRequest, NextResponse } from 'next/server';
import { getServiceDeps } from '../../../../../../../lib/service-container.js';
import { listShiftsForStaff } from '../../../../../../../services/shifts.service.js';
import { isStaffError } from '../../../../../../../lib/staff-errors.js';
import type { ShiftStatus } from '../../../../../../../types/staff.js';

export async function GET(
  req: NextRequest,
  { params }: { params: { promoterId: string; staffId: string } },
) {
  const userId = req.headers.get('x-user-id');
  if (!userId) return NextResponse.json({ error: 'UNAUTHORIZED' }, { status: 401 });

  try {
    const url = new URL(req.url);
    const fromStr = url.searchParams.get('from');
    const toStr = url.searchParams.get('to');
    const status = url.searchParams.get('status') as ShiftStatus | null;

    const deps = getServiceDeps();
    const items = await listShiftsForStaff(
      params.staffId,
      params.promoterId,
      {
        from: fromStr ? new Date(fromStr) : undefined,
        to: toStr ? new Date(toStr) : undefined,
        status: status ?? undefined,
      },
      deps,
    );
    return NextResponse.json({ items });
  } catch (err) {
    if (isStaffError(err)) {
      const http = err.toHttpError();
      return NextResponse.json(http, { status: http.statusCode });
    }
    throw err;
  }
}
