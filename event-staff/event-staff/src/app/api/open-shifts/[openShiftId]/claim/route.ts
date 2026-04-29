import { NextRequest, NextResponse } from 'next/server';
import { getServiceDeps } from '../../../../../lib/service-container.js';
import { claimOpenShift } from '../../../../../services/open-shifts.service.js';
import { claimOpenShiftSchema } from '../../../../../lib/zod-schemas.js';
import { isStaffError } from '../../../../../lib/staff-errors.js';

/**
 * POST /open-shifts/[openShiftId]/claim
 * Body: { staffId: string }
 * Header: x-promoter-id
 *
 * Staff member claims an open shift. Atomically creates a regular shift and
 * increments the claimed counter.
 */
export async function POST(
  req: NextRequest,
  { params }: { params: { openShiftId: string } },
) {
  const userId = req.headers.get('x-user-id');
  const promoterId = req.headers.get('x-promoter-id');

  if (!userId || !promoterId) {
    return NextResponse.json({ error: 'UNAUTHORIZED' }, { status: 401 });
  }

  try {
    const body = await req.json();
    const parsed = claimOpenShiftSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: 'VALIDATION_ERROR', issues: parsed.error.issues },
        { status: 400 },
      );
    }

    const deps = getServiceDeps();
    const result = await claimOpenShift(params.openShiftId, parsed.data.staffId, promoterId, deps);
    return NextResponse.json(result, { status: 201 });
  } catch (err) {
    if (isStaffError(err)) {
      const http = err.toHttpError();
      return NextResponse.json(http, { status: http.statusCode });
    }
    throw err;
  }
}
