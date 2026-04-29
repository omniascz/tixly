import { NextRequest, NextResponse } from 'next/server';
import { reorderPhotos } from '../../../../../../services/branch-photos.service';
import { isBranchError } from '../../../../../../lib/branch-errors';

function getDb() {
  return {
    query: async <T>(_sql: string, _params?: unknown[]): Promise<{ rows: T[] }> => ({ rows: [] }),
    execute: async (_sql: string, _params?: unknown[]): Promise<void> => {},
  };
}

export async function POST(
  request: NextRequest,
  { params }: { params: { branchId: string } },
) {
  try {
    const promoterId = request.headers.get('x-promoter-id');
    if (!promoterId) {
      return NextResponse.json(
        { error: 'UNAUTHORIZED', message: 'Chybí identifikace promotéra.' },
        { status: 401 },
      );
    }
    const body = await request.json();
    const orderedIds: string[] = Array.isArray(body.orderedIds) ? body.orderedIds : [];
    const db = getDb();
    const photos = await reorderPhotos(params.branchId, promoterId, orderedIds, db);
    return NextResponse.json(photos);
  } catch (err) {
    if (isBranchError(err)) {
      return NextResponse.json(err.toHttpError(), { status: err.statusCode });
    }
    return NextResponse.json(
      { error: 'INTERNAL_ERROR', message: 'Došlo k neočekávané chybě.' },
      { status: 500 },
    );
  }
}
