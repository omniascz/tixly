import { NextRequest, NextResponse } from 'next/server';
import { getServiceDeps } from '../../../../../lib/service-container.js';
import {
  createRecurringTemplate,
  listRecurringTemplates,
} from '../../../../../services/recurring-shifts.service.js';
import { isStaffError } from '../../../../../lib/staff-errors.js';
import type { CreateRecurringShiftInput } from '../../../../../types/staff.js';

export async function GET(
  req: NextRequest,
  { params }: { params: { promoterId: string } },
): Promise<NextResponse> {
  const userId = req.headers.get('x-user-id');
  if (!userId) return NextResponse.json({ error: 'UNAUTHORIZED' }, { status: 401 });

  try {
    const url = new URL(req.url);
    const branchId = url.searchParams.get('branchId');
    const deps = getServiceDeps();
    const items = await listRecurringTemplates(params.promoterId, branchId, deps);
    return NextResponse.json({ items }, { status: 200 });
  } catch (err) {
    if (isStaffError(err)) {
      return NextResponse.json(err.toHttpError(), { status: err.statusCode });
    }
    throw err;
  }
}

export async function POST(
  req: NextRequest,
  { params }: { params: { promoterId: string } },
): Promise<NextResponse> {
  const userId = req.headers.get('x-user-id');
  if (!userId) return NextResponse.json({ error: 'UNAUTHORIZED' }, { status: 401 });

  try {
    const body = (await req.json()) as CreateRecurringShiftInput;
    const deps = getServiceDeps();
    const template = await createRecurringTemplate(params.promoterId, body, deps);
    return NextResponse.json(template, { status: 201 });
  } catch (err) {
    if (isStaffError(err)) {
      return NextResponse.json(err.toHttpError(), { status: err.statusCode });
    }
    throw err;
  }
}
