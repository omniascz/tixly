import { NextRequest, NextResponse } from 'next/server';
import { getServiceDeps } from '../../../../../../../../lib/service-container.js';
import {
  getAvailabilityBlock,
  approveAvailability,
  deleteAvailability,
} from '../../../../../../../../services/availability.service.js';
import { isStaffError } from '../../../../../../../../lib/staff-errors.js';

async function assertPromoterMember(_userId: string, _promoterId: string): Promise<boolean> {
  return true;
}

export async function GET(
  req: NextRequest,
  { params }: { params: { promoterId: string; staffId: string; blockId: string } },
) {
  const userId = req.headers.get('x-user-id');
  if (!userId) return NextResponse.json({ error: 'UNAUTHORIZED' }, { status: 401 });

  const allowed = await assertPromoterMember(userId, params.promoterId);
  if (!allowed) return NextResponse.json({ error: 'FORBIDDEN' }, { status: 403 });

  try {
    const deps = getServiceDeps();
    const block = await getAvailabilityBlock(params.blockId, params.promoterId, deps);
    return NextResponse.json(block);
  } catch (err) {
    if (isStaffError(err)) {
      const http = err.toHttpError();
      return NextResponse.json(http, { status: http.statusCode });
    }
    throw err;
  }
}

/** PATCH with body {} or { approve: true } — approves the availability block */
export async function PATCH(
  req: NextRequest,
  { params }: { params: { promoterId: string; staffId: string; blockId: string } },
) {
  const userId = req.headers.get('x-user-id');
  if (!userId) return NextResponse.json({ error: 'UNAUTHORIZED' }, { status: 401 });

  const allowed = await assertPromoterMember(userId, params.promoterId);
  if (!allowed) return NextResponse.json({ error: 'FORBIDDEN' }, { status: 403 });

  try {
    const deps = getServiceDeps();
    const block = await approveAvailability(params.blockId, params.promoterId, deps);
    return NextResponse.json(block);
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
  { params }: { params: { promoterId: string; staffId: string; blockId: string } },
) {
  const userId = req.headers.get('x-user-id');
  if (!userId) return NextResponse.json({ error: 'UNAUTHORIZED' }, { status: 401 });

  const allowed = await assertPromoterMember(userId, params.promoterId);
  if (!allowed) return NextResponse.json({ error: 'FORBIDDEN' }, { status: 403 });

  try {
    const deps = getServiceDeps();
    await deleteAvailability(params.blockId, params.promoterId, deps);
    return new NextResponse(null, { status: 204 });
  } catch (err) {
    if (isStaffError(err)) {
      const http = err.toHttpError();
      return NextResponse.json(http, { status: http.statusCode });
    }
    throw err;
  }
}
