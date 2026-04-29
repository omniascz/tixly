import { NextRequest, NextResponse } from 'next/server';
import { getServiceDeps } from '../../../../../../lib/service-container.js';
import { materializeShifts } from '../../../../../../services/recurring-shifts.service.js';
import { isStaffError, StaffError } from '../../../../../../lib/staff-errors.js';

export async function POST(
  req: NextRequest,
  { params }: { params: { promoterId: string } },
): Promise<NextResponse> {
  const userId = req.headers.get('x-user-id');
  if (!userId) return NextResponse.json({ error: 'UNAUTHORIZED' }, { status: 401 });

  try {
    const body = (await req.json()) as { from: string; to: string };
    const from = new Date(body.from);
    const to = new Date(body.to);
    if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime()) || from > to) {
      throw new StaffError('RECURRING_TEMPLATE_INVALID', 'Neplatný rozsah from/to.');
    }
    const deps = getServiceDeps();
    const result = await materializeShifts(params.promoterId, from, to, deps);
    return NextResponse.json(result, { status: 200 });
  } catch (err) {
    if (isStaffError(err)) {
      return NextResponse.json(err.toHttpError(), { status: err.statusCode });
    }
    throw err;
  }
}
