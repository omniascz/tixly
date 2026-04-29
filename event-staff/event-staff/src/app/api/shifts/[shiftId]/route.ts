import { NextRequest, NextResponse } from 'next/server';
import { getServiceDeps } from '../../../../lib/service-container.js';
import {
  getShift,
  updateShift,
  cancelShift,
} from '../../../../services/shifts.service.js';
import { updateShiftSchema } from '../../../../lib/zod-schemas.js';
import { isStaffError } from '../../../../lib/staff-errors.js';

function requirePromoterId(req: NextRequest): string | null {
  const url = new URL(req.url);
  return url.searchParams.get('promoterId');
}

export async function GET(
  req: NextRequest,
  { params }: { params: { shiftId: string } },
) {
  const userId = req.headers.get('x-user-id');
  if (!userId) return NextResponse.json({ error: 'UNAUTHORIZED' }, { status: 401 });

  const promoterId = requirePromoterId(req);
  if (!promoterId)
    return NextResponse.json({ error: 'VALIDATION_ERROR', message: 'promoterId required' }, { status: 400 });

  try {
    const deps = getServiceDeps();
    const shift = await getShift(params.shiftId, promoterId, deps);
    return NextResponse.json(shift);
  } catch (err) {
    if (isStaffError(err)) {
      const http = err.toHttpError();
      return NextResponse.json(http, { status: http.statusCode });
    }
    throw err;
  }
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: { shiftId: string } },
) {
  const userId = req.headers.get('x-user-id');
  if (!userId) return NextResponse.json({ error: 'UNAUTHORIZED' }, { status: 401 });

  const promoterId = requirePromoterId(req);
  if (!promoterId)
    return NextResponse.json({ error: 'VALIDATION_ERROR', message: 'promoterId required' }, { status: 400 });

  try {
    const body = await req.json();
    const parsed = updateShiftSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: 'VALIDATION_ERROR', issues: parsed.error.issues },
        { status: 400 },
      );
    }
    const deps = getServiceDeps();
    const updated = await updateShift(params.shiftId, promoterId, parsed.data, deps);
    return NextResponse.json(updated);
  } catch (err) {
    if (isStaffError(err)) {
      const http = err.toHttpError();
      return NextResponse.json(http, { status: http.statusCode });
    }
    throw err;
  }
}

export async function DELETE(
  req: NextRequest,
  { params }: { params: { shiftId: string } },
) {
  const userId = req.headers.get('x-user-id');
  if (!userId) return NextResponse.json({ error: 'UNAUTHORIZED' }, { status: 401 });

  const promoterId = requirePromoterId(req);
  if (!promoterId)
    return NextResponse.json({ error: 'VALIDATION_ERROR', message: 'promoterId required' }, { status: 400 });

  try {
    const deps = getServiceDeps();
    const cancelled = await cancelShift(params.shiftId, promoterId, deps);
    return NextResponse.json(cancelled);
  } catch (err) {
    if (isStaffError(err)) {
      const http = err.toHttpError();
      return NextResponse.json(http, { status: http.statusCode });
    }
    throw err;
  }
}
