import { NextRequest, NextResponse } from 'next/server';
import { getAllSettings } from '../../../../../../services/branch-settings.service';
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
    const settings = await getAllSettings(params.branchId, db);
    return NextResponse.json(settings);
  } catch (err) {
    if (isBranchError(err)) {
      return NextResponse.json(err.toHttpError(), { status: err.statusCode });
    }
    return NextResponse.json({ error: 'INTERNAL_ERROR', message: 'Unexpected error' }, { status: 500 });
  }
}
