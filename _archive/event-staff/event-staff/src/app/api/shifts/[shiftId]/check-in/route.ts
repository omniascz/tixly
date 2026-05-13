import { NextRequest, NextResponse } from 'next/server';
import { getServiceDeps } from '../../../../../lib/service-container.js';
import { checkInShift } from '../../../../../services/shifts.service.js';
import { isStaffError } from '../../../../../lib/staff-errors.js';

export async function POST(
  req: NextRequest,
  { params }: { params: { shiftId: string } },
) {
  const userId = req.headers.get('x-user-id');
  if (!userId) return NextResponse.json({ error: 'UNAUTHORIZED' }, { status: 401 });

  const url = new URL(req.url);
  const promoterId = url.searchParams.get('promoterId');
  if (!promoterId)
    return NextResponse.json({ error: 'VALIDATION_ERROR', message: 'promoterId required' }, { status: 400 });

  try {
    const deps = getServiceDeps();
    const shift = await checkInShift(params.shiftId, promoterId, deps);
    return NextResponse.json(shift);
  } catch (err) {
    if (isStaffError(err)) {
      const http = err.toHttpError();
      return NextResponse.json(http, { status: http.statusCode });
    }
    throw err;
  }
}
