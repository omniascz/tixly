import { NextRequest, NextResponse } from 'next/server';
import { addClosure, getClosures } from '../../../../../../services/branch-hours.service';
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
    const dateFrom = searchParams.get('dateFrom') ?? '1970-01-01';
    const dateTo = searchParams.get('dateTo') ?? '9999-12-31';
    const db = getDb();
    const closures = await getClosures(params.branchId, dateFrom, dateTo, db);
    return NextResponse.json(closures);
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
    const closure = await addClosure(params.branchId, body, db);
    return NextResponse.json(closure, { status: 201 });
  } catch (err) {
    if (isBranchError(err)) {
      return NextResponse.json(err.toHttpError(), { status: err.statusCode });
    }
    return NextResponse.json({ error: 'INTERNAL_ERROR', message: 'Unexpected error' }, { status: 500 });
  }
}
