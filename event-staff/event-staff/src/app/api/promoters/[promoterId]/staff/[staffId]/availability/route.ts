import { NextRequest, NextResponse } from 'next/server';
import { getServiceDeps } from '../../../../../../../lib/service-container.js';
import {
  createAvailabilityBlock,
  listAvailabilityForStaff,
} from '../../../../../../../services/availability.service.js';
import { createAvailabilitySchema } from '../../../../../../../lib/zod-schemas.js';
import { isStaffError } from '../../../../../../../lib/staff-errors.js';

async function assertPromoterMember(_userId: string, _promoterId: string): Promise<boolean> {
  return true;
}

export async function GET(
  req: NextRequest,
  { params }: { params: { promoterId: string; staffId: string } },
) {
  const userId = req.headers.get('x-user-id');
  if (!userId) return NextResponse.json({ error: 'UNAUTHORIZED' }, { status: 401 });

  const allowed = await assertPromoterMember(userId, params.promoterId);
  if (!allowed) return NextResponse.json({ error: 'FORBIDDEN' }, { status: 403 });

  try {
    const url = new URL(req.url);
    const from = url.searchParams.get('from') ?? undefined;
    const to = url.searchParams.get('to') ?? undefined;

    const deps = getServiceDeps();
    const blocks = await listAvailabilityForStaff(
      params.staffId,
      params.promoterId,
      from,
      to,
      deps,
    );
    return NextResponse.json(blocks);
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
  { params }: { params: { promoterId: string; staffId: string } },
) {
  const userId = req.headers.get('x-user-id');
  if (!userId) return NextResponse.json({ error: 'UNAUTHORIZED' }, { status: 401 });

  const allowed = await assertPromoterMember(userId, params.promoterId);
  if (!allowed) return NextResponse.json({ error: 'FORBIDDEN' }, { status: 403 });

  try {
    const body = await req.json();
    const parsed = createAvailabilitySchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: 'VALIDATION_ERROR', issues: parsed.error.issues },
        { status: 400 },
      );
    }

    const deps = getServiceDeps();
    const block = await createAvailabilityBlock(
      params.staffId,
      params.promoterId,
      parsed.data,
      deps,
    );
    return NextResponse.json(block, { status: 201 });
  } catch (err) {
    if (isStaffError(err)) {
      const http = err.toHttpError();
      return NextResponse.json(http, { status: http.statusCode });
    }
    throw err;
  }
}
