import { NextRequest, NextResponse } from 'next/server';
import { getServiceDeps } from '../../../../../lib/service-container.js';
import { createStaffMember, listStaffMembers } from '../../../../../services/staff.service.js';
import { createStaffMemberSchema } from '../../../../../lib/zod-schemas.js';
import { StaffError, isStaffError } from '../../../../../lib/staff-errors.js';
import type { StaffRole, StaffStatus } from '../../../../../types/staff.js';

async function assertPromoterMember(
  userId: string,
  promoterId: string,
): Promise<boolean> {
  // TODO: enforce promoter membership via promoter-onboarding service
  // For now: trust authenticated user; downstream queries are scoped by promoterId.
  return true;
}

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
    const status = url.searchParams.get('status') as StaffStatus | null;
    const role = url.searchParams.get('role') as StaffRole | null;
    const search = url.searchParams.get('search');
    const limit = url.searchParams.get('limit');
    const offset = url.searchParams.get('offset');

    const deps = getServiceDeps();
    const result = await listStaffMembers(
      params.promoterId,
      {
        status: status ?? undefined,
        role: role ?? undefined,
        search: search ?? undefined,
      },
      {
        limit: limit ? Number(limit) : undefined,
        offset: offset ? Number(offset) : undefined,
      },
      deps,
    );
    return NextResponse.json(result);
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
  { params }: { params: { promoterId: string } },
) {
  const userId = req.headers.get('x-user-id');
  if (!userId) return NextResponse.json({ error: 'UNAUTHORIZED' }, { status: 401 });

  const allowed = await assertPromoterMember(userId, params.promoterId);
  if (!allowed) return NextResponse.json({ error: 'FORBIDDEN' }, { status: 403 });

  try {
    const body = await req.json();
    const parsed = createStaffMemberSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: 'VALIDATION_ERROR', issues: parsed.error.issues },
        { status: 400 },
      );
    }

    const deps = getServiceDeps();
    const created = await createStaffMember(params.promoterId, parsed.data, deps);
    return NextResponse.json(created, { status: 201 });
  } catch (err) {
    if (isStaffError(err)) {
      const http = err.toHttpError();
      return NextResponse.json(http, { status: http.statusCode });
    }
    throw err;
  }
}
