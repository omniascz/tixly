import { NextRequest, NextResponse } from 'next/server';
import { getSetting, setSetting, deleteSetting } from '../../../../../../../services/branch-settings.service';
import { isBranchError } from '../../../../../../../lib/branch-errors';

function getDb() {
  return {
    query: async <T>(_sql: string, _params?: unknown[]): Promise<{ rows: T[] }> => ({ rows: [] }),
    execute: async (_sql: string, _params?: unknown[]): Promise<void> => {},
  };
}

export async function GET(
  _request: NextRequest,
  { params }: { params: { branchId: string; key: string } },
) {
  try {
    const db = getDb();
    const setting = await getSetting(params.branchId, params.key, db);
    return NextResponse.json(setting);
  } catch (err) {
    if (isBranchError(err)) {
      return NextResponse.json(err.toHttpError(), { status: err.statusCode });
    }
    return NextResponse.json({ error: 'INTERNAL_ERROR', message: 'Unexpected error' }, { status: 500 });
  }
}

export async function PUT(
  request: NextRequest,
  { params }: { params: { branchId: string; key: string } },
) {
  try {
    const promoterId = request.headers.get('x-promoter-id');
    if (!promoterId) {
      return NextResponse.json({ error: 'UNAUTHORIZED', message: 'Missing x-promoter-id' }, { status: 401 });
    }
    const body = await request.json();
    const db = getDb();
    const setting = await setSetting(params.branchId, promoterId, params.key, body.value, body.type ?? 'string', db);
    return NextResponse.json(setting);
  } catch (err) {
    if (isBranchError(err)) {
      return NextResponse.json(err.toHttpError(), { status: err.statusCode });
    }
    return NextResponse.json({ error: 'INTERNAL_ERROR', message: 'Unexpected error' }, { status: 500 });
  }
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: { branchId: string; key: string } },
) {
  try {
    const promoterId = request.headers.get('x-promoter-id');
    if (!promoterId) {
      return NextResponse.json({ error: 'UNAUTHORIZED', message: 'Missing x-promoter-id' }, { status: 401 });
    }
    const db = getDb();
    await deleteSetting(params.branchId, promoterId, params.key, db);
    return new NextResponse(null, { status: 204 });
  } catch (err) {
    if (isBranchError(err)) {
      return NextResponse.json(err.toHttpError(), { status: err.statusCode });
    }
    return NextResponse.json({ error: 'INTERNAL_ERROR', message: 'Unexpected error' }, { status: 500 });
  }
}
