import { NextRequest, NextResponse } from 'next/server';
import { createBranch, listBranches } from '../../../../services/branch.service';
import { isBranchError } from '../../../../lib/branch-errors';

function getDb() {
  return {
    query: async <T>(_sql: string, _params?: unknown[]): Promise<{ rows: T[] }> => ({ rows: [] }),
    execute: async (_sql: string, _params?: unknown[]): Promise<void> => {},
  };
}

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const promoterId = searchParams.get('promoterId') ?? '';
    const filters = {
      isActive: searchParams.has('isActive') ? searchParams.get('isActive') === 'true' : undefined,
      city: searchParams.get('city') ?? undefined,
    };
    const db = getDb();
    const branches = await listBranches(promoterId, filters, db);
    return NextResponse.json(branches);
  } catch (err) {
    if (isBranchError(err)) {
      return NextResponse.json(err.toHttpError(), { status: err.statusCode });
    }
    return NextResponse.json({ error: 'INTERNAL_ERROR', message: 'Unexpected error' }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const promoterId = searchParams.get('promoterId') ?? '';
    const body = await request.json();
    const db = getDb();
    const branch = await createBranch(promoterId, body, db);
    return NextResponse.json(branch, { status: 201 });
  } catch (err) {
    if (isBranchError(err)) {
      return NextResponse.json(err.toHttpError(), { status: err.statusCode });
    }
    return NextResponse.json({ error: 'INTERNAL_ERROR', message: 'Unexpected error' }, { status: 500 });
  }
}
