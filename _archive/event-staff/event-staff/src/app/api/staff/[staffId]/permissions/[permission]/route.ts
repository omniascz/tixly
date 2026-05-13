import { NextRequest, NextResponse } from 'next/server';
import { getServiceDeps } from '../../../../../../lib/service-container.js';
import { hasStaffPermission } from '../../../../../../services/staff.service.js';
import type { StaffPermission } from '../../../../../../types/staff.js';

export async function GET(
  req: NextRequest,
  { params }: { params: { staffId: string; permission: string } },
) {
  const userId = req.headers.get('x-user-id');
  if (!userId) return NextResponse.json({ error: 'UNAUTHORIZED' }, { status: 401 });

  const deps = getServiceDeps();
  const allowed = await hasStaffPermission(
    params.staffId,
    params.permission as StaffPermission,
    deps,
  );
  return NextResponse.json({ allowed });
}
