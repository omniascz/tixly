import { NextRequest, NextResponse } from 'next/server';
import { getServiceDeps } from '../../../../../../lib/service-container.js';
import {
  getStaffMember,
  updateStaffMember,
  archiveStaffMember,
} from '../../../../../../services/staff.service.js';
import { updateStaffMemberSchema } from '../../../../../../lib/zod-schemas.js';
import { isStaffError } from '../../../../../../lib/staff-errors.js';

async function assertPromoterMember(
  _userId: string,
  _promoterId: string,
): Promise<boolean> {
  // TODO: enforce promoter membership via promoter-onboarding service
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
    const deps = getServiceDeps();
    const member = await getStaffMember(params.staffId, params.promoterId, deps);
    return NextResponse.json(member);
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
  { params }: { params: { promoterId: string; staffId: string } },
) {
  const userId = req.headers.get('x-user-id');
  if (!userId) return NextResponse.json({ error: 'UNAUTHORIZED' }, { status: 401 });

  const allowed = await assertPromoterMember(userId, params.promoterId);
  if (!allowed) return NextResponse.json({ error: 'FORBIDDEN' }, { status: 403 });

  try {
    const body = await req.json();
    const parsed = updateStaffMemberSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: 'VALIDATION_ERROR', issues: parsed.error.issues },
        { status: 400 },
      );
    }
    const deps = getServiceDeps();
    const updated = await updateStaffMember(
      params.staffId,
      params.promoterId,
      parsed.data,
      deps,
    );
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
  { params }: { params: { promoterId: string; staffId: string } },
) {
  const userId = req.headers.get('x-user-id');
  if (!userId) return NextResponse.json({ error: 'UNAUTHORIZED' }, { status: 401 });

  const allowed = await assertPromoterMember(userId, params.promoterId);
  if (!allowed) return NextResponse.json({ error: 'FORBIDDEN' }, { status: 403 });

  try {
    const deps = getServiceDeps();
    await archiveStaffMember(params.staffId, params.promoterId, deps);
    return new NextResponse(null, { status: 204 });
  } catch (err) {
    if (isStaffError(err)) {
      const http = err.toHttpError();
      return NextResponse.json(http, { status: http.statusCode });
    }
    throw err;
  }
}
