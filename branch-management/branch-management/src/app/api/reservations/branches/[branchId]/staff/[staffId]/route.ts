import { NextRequest, NextResponse } from 'next/server';
import { updateStaffRole, removeStaff } from '../../../../../../../services/branch-staff.service';
import { isBranchError } from '../../../../../../../lib/branch-errors';

function getDb() {
  return {
    query: async <T>(_sql: string, _params?: unknown[]): Promise<{ rows: T[] }> => ({ rows: [] }),
    execute: async (_sql: string, _params?: unknown[]): Promise<void> => {},
  };
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: { staffId: string } },
) {
  try {
    const promoterId = request.headers.get('x-promoter-id');
    if (!promoterId) {
      return NextResponse.json({ error: 'UNAUTHORIZED', message: 'Missing x-promoter-id' }, { status: 401 });
    }
    const body = await request.json();
    const db = getDb();
    const staff = await updateStaffRole(params.staffId, promoterId, body.role, db);
    return NextResponse.json(staff);
  } catch (err) {
    if (isBranchError(err)) {
      return NextResponse.json(err.toHttpError(), { status: err.statusCode });
    }
    return NextResponse.json({ error: 'INTERNAL_ERROR', message: 'Unexpected error' }, { status: 500 });
  }
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: { staffId: string } },
) {
  try {
    const promoterId = request.headers.get('x-promoter-id');
    if (!promoterId) {
      return NextResponse.json({ error: 'UNAUTHORIZED', message: 'Missing x-promoter-id' }, { status: 401 });
    }
    const db = getDb();
    await removeStaff(params.staffId, promoterId, db);
    return new NextResponse(null, { status: 204 });
  } catch (err) {
    if (isBranchError(err)) {
      return NextResponse.json(err.toHttpError(), { status: err.statusCode });
    }
    return NextResponse.json({ error: 'INTERNAL_ERROR', message: 'Unexpected error' }, { status: 500 });
  }
}
