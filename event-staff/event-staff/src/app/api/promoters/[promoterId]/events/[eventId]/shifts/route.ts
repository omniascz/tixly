import { NextRequest, NextResponse } from 'next/server';
import { getServiceDeps } from '../../../../../../../lib/service-container.js';
import {
  createShift,
  bulkCreateShifts,
  listShiftsForEvent,
} from '../../../../../../../services/shifts.service.js';
import {
  createShiftSchema,
  bulkCreateShiftsSchema,
} from '../../../../../../../lib/zod-schemas.js';
import { isStaffError } from '../../../../../../../lib/staff-errors.js';

export async function GET(
  req: NextRequest,
  { params }: { params: { promoterId: string; eventId: string } },
) {
  const userId = req.headers.get('x-user-id');
  if (!userId) return NextResponse.json({ error: 'UNAUTHORIZED' }, { status: 401 });

  try {
    const deps = getServiceDeps();
    const items = await listShiftsForEvent(params.eventId, params.promoterId, deps);
    return NextResponse.json({ items });
  } catch (err) {
    if (isStaffError(err)) {
      const http = err.toHttpError();
      return NextResponse.json(http, { status: http.statusCode });
    }
    throw err;
  }
}

export async function POST(
  req: NextRequest,
  { params }: { params: { promoterId: string; eventId: string } },
) {
  const userId = req.headers.get('x-user-id');
  if (!userId) return NextResponse.json({ error: 'UNAUTHORIZED' }, { status: 401 });

  try {
    const body = await req.json();
    const parsed = createShiftSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: 'VALIDATION_ERROR', issues: parsed.error.issues },
        { status: 400 },
      );
    }
    const deps = getServiceDeps();
    const created = await createShift(params.promoterId, params.eventId, parsed.data, deps);
    return NextResponse.json(created, { status: 201 });
  } catch (err) {
    if (isStaffError(err)) {
      const http = err.toHttpError();
      return NextResponse.json(http, { status: http.statusCode });
    }
    throw err;
  }
}

export async function PUT(
  req: NextRequest,
  { params }: { params: { promoterId: string; eventId: string } },
) {
  const userId = req.headers.get('x-user-id');
  if (!userId) return NextResponse.json({ error: 'UNAUTHORIZED' }, { status: 401 });

  try {
    const body = await req.json();
    const { bulk: _bulk, ...rest } = body ?? {};
    const parsed = bulkCreateShiftsSchema.safeParse(rest);
    if (!parsed.success) {
      return NextResponse.json(
        { error: 'VALIDATION_ERROR', issues: parsed.error.issues },
        { status: 400 },
      );
    }
    const deps = getServiceDeps();
    const result = await bulkCreateShifts(
      params.promoterId,
      params.eventId,
      parsed.data,
      deps,
    );
    return NextResponse.json(result, { status: 201 });
  } catch (err) {
    if (isStaffError(err)) {
      const http = err.toHttpError();
      return NextResponse.json(http, { status: http.statusCode });
    }
    throw err;
  }
}
