import { NextRequest, NextResponse } from 'next/server';
import { getServiceDeps } from '../../../../../lib/service-container.js';
import { createOpenShift, listOpenShifts } from '../../../../../services/open-shifts.service.js';
import { createOpenShiftSchema } from '../../../../../lib/zod-schemas.js';
import { isStaffError } from '../../../../../lib/staff-errors.js';

async function assertPromoterMember(_userId: string, _promoterId: string): Promise<boolean> {
  return true;
}

/** GET /promoters/[promoterId]/open-shifts?eventId=... */
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
    const eventId = url.searchParams.get('eventId') ?? undefined;

    const deps = getServiceDeps();
    const shifts = await listOpenShifts(params.promoterId, eventId, deps);
    return NextResponse.json(shifts);
  } catch (err) {
    if (isStaffError(err)) {
      const http = err.toHttpError();
      return NextResponse.json(http, { status: http.statusCode });
    }
    throw err;
  }
}

/** POST /promoters/[promoterId]/open-shifts */
export async function POST(
  req: NextRequest,
  { params }: { params: { promoterId: string } },
) {
  const userId = req.headers.get('x-user-id');
  if (!userId) return NextResponse.json({ error: 'UNAUTHORIZED' }, { status: 401 });

  const allowed = await assertPromoterMember(userId, params.promoterId);
  if (!allowed) return NextResponse.json({ error: 'FORBIDDEN' }, { status: 403 });

  try {
    const body = await req.json();
    const parsed = createOpenShiftSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: 'VALIDATION_ERROR', issues: parsed.error.issues },
        { status: 400 },
      );
    }

    const deps = getServiceDeps();
    const shift = await createOpenShift(params.promoterId, parsed.data, deps);
    return NextResponse.json(shift, { status: 201 });
  } catch (err) {
    if (isStaffError(err)) {
      const http = err.toHttpError();
      return NextResponse.json(http, { status: http.statusCode });
    }
    throw err;
  }
}
