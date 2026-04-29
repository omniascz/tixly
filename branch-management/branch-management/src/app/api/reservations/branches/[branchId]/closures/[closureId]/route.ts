import { NextRequest, NextResponse } from 'next/server';
import { removeClosure } from '../../../../../../../services/branch-hours.service';
import { isBranchError } from '../../../../../../../lib/branch-errors';

function getDb() {
  return {
    query: async <T>(_sql: string, _params?: unknown[]): Promise<{ rows: T[] }> => ({ rows: [] }),
    execute: async (_sql: string, _params?: unknown[]): Promise<void> => {},
  };
}

export async function DELETE(
  _request: NextRequest,
  { params }: { params: { closureId: string } },
) {
  try {
    const db = getDb();
    await removeClosure(params.closureId, db);
    return new NextResponse(null, { status: 204 });
  } catch (err) {
    if (isBranchError(err)) {
      return NextResponse.json(err.toHttpError(), { status: err.statusCode });
    }
    return NextResponse.json({ error: 'INTERNAL_ERROR', message: 'Unexpected error' }, { status: 500 });
  }
}
