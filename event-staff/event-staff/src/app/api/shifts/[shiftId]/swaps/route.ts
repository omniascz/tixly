import { NextRequest, NextResponse } from 'next/server';
import { getServiceDeps } from '../../../../../lib/service-container.js';
import { createSwapRequest } from '../../../../../services/swap.service.js';
import { createSwapRequestSchema } from '../../../../../lib/zod-schemas.js';
import { isStaffError } from '../../../../../lib/staff-errors.js';

/**
 * POST /shifts/[shiftId]/swaps
 * Body: { targetStaffId?: string; reason?: string }
 * Header: x-staff-id (the requester)
 *
 * Creates a shift swap request. The requester must be the assigned staff on the shift.
 */
export async function POST(
  req: NextRequest,
  { params }: { params: { shiftId: string } },
) {
  const userId = req.headers.get('x-user-id');
  const staffId = req.headers.get('x-staff-id');
  const promoterId = req.headers.get('x-promoter-id');

  if (!userId || !staffId || !promoterId) {
    return NextResponse.json({ error: 'UNAUTHORIZED' }, { status: 401 });
  }

  try {
    const body = await req.json();
    const parsed = createSwapRequestSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: 'VALIDATION_ERROR', issues: parsed.error.issues },
        { status: 400 },
      );
    }

    const deps = getServiceDeps();
    const swap = await createSwapRequest(
      params.shiftId,
      staffId,
      promoterId,
      parsed.data,
      deps,
    );
    return NextResponse.json(swap, { status: 201 });
  } catch (err) {
    if (isStaffError(err)) {
      const http = err.toHttpError();
      return NextResponse.json(http, { status: http.statusCode });
    }
    throw err;
  }
}
