import { NextRequest, NextResponse } from 'next/server';
import { getHours, setWeeklyHours } from '../../../../../../services/branch-hours.service';
import { isBranchError } from '../../../../../../lib/branch-errors';

function getDb() {
  return {
    query: async <T>(_sql: string, _params?: unknown[]): Promise<{ rows: T[] }> => ({ rows: [] }),
    execute: async (_sql: string, _params?: unknown[]): Promise<void> => {},
  };
}

export async function GET(
  _request: NextRequest,
  { params }: { params: { branchId: string } },
) {
  try {
    const db = getDb();
    const hours = await getHours(params.branchId, db);
    return NextResponse.json(hours);
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
    const db = getDb();
    const hours = await setWeeklyHours(params.branchId, body, db);
    return NextResponse.json(hours, { status: 201 });
  } catch (err) {
    if (isBranchError(err)) {
      return NextResponse.json(err.toHttpError(), { status: err.statusCode });
    }
    return NextResponse.json({ error: 'INTERNAL_ERROR', message: 'Unexpected error' }, { status: 500 });
  }
}
