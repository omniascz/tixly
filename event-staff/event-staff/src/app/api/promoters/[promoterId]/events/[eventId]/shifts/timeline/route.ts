import { NextRequest, NextResponse } from 'next/server';
import { getServiceDeps } from '../../../../../../../../lib/service-container.js';
import { getEventShiftTimeline } from '../../../../../../../../services/shifts.service.js';
import { isStaffError } from '../../../../../../../../lib/staff-errors.js';

export async function GET(
  req: NextRequest,
  { params }: { params: { promoterId: string; eventId: string } },
) {
  const userId = req.headers.get('x-user-id');
  if (!userId) return NextResponse.json({ error: 'UNAUTHORIZED' }, { status: 401 });

  try {
    const deps = getServiceDeps();
    const slots = await getEventShiftTimeline(params.eventId, params.promoterId, deps);
    return NextResponse.json({ slots });
  } catch (err) {
    if (isStaffError(err)) {
      const http = err.toHttpError();
      return NextResponse.json(http, { status: http.statusCode });
    }
    throw err;
  }
}
