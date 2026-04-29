import { NextRequest, NextResponse } from 'next/server';
import { addStaff, listStaff } from '../../../../../../services/branch-staff.service';
import { isBranchError } from '../../../../../../lib/branch-errors';

function getDb() {
  return {
    query: async <T>(_sql: string, _params?: unknown[]): Promise<{ rows: T[] }> => ({ rows: [] }),
    execute: async (_sql: string, _params?: unknown[]): Promise<void> => {},
  };
}

export async function GET(
  request: NextRequest,
  { params }: { params: { branchId: string } },
) {
  try {
    const { searchParams } = new URL(request.url);
    const filters = {
      role: searchParams.get('role') as ('manager' | 'staff' | 'receptionist' | 'instructor' | 'viewer') | undefined ?? undefined,
      isActive: searchParams.has('isActive') ? searchParams.get('isActive') === 'true' : undefined,
    };
    const db = getDb();
    const staff = await listStaff(params.branchId, filters, db);
    return NextResponse.json(staff);
  } catch (err) {
    if (isBranchError(err)) {
      return NextResponse.json(err.toHttpError(), { status: err.statusCode });
    }
    return NextResponse.json({ error: 'INTERNAL_ERROR', message: 'Unexpected error' }, { status: 500 });
  }
}

export async function POST(
  request: NextRequest,
  { params }: { params: { branchId: string } },
) {
  try {
    const body = await request.json();
    const { userId, role, ...input } = body;
    const db = getDb();
    const staff = await addStaff(params.branchId, userId, role, input, db);
    return NextResponse.json(staff, { status: 201 });
  } catch (err) {
    if (isBranchError(err)) {
      return NextResponse.json(err.toHttpError(), { status: err.statusCode });
    }
    return NextResponse.json({ error: 'INTERNAL_ERROR', message: 'Unexpected error' }, { status: 500 });
  }
}
