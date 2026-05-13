import { NextRequest, NextResponse } from 'next/server';
import {
  deletePhoto,
  updatePhoto,
} from '../../../../../services/branch-photos.service';
import { isBranchError } from '../../../../../lib/branch-errors';

function getDb() {
  return {
    query: async <T>(_sql: string, _params?: unknown[]): Promise<{ rows: T[] }> => ({ rows: [] }),
    execute: async (_sql: string, _params?: unknown[]): Promise<void> => {},
  };
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: { photoId: string } },
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
    const db = getDb();
    const photo = await updatePhoto(
      params.photoId,
      promoterId,
      { alt: body.alt, caption: body.caption, category: body.category },
      db,
    );
    return NextResponse.json(photo);
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

export async function DELETE(
  request: NextRequest,
  { params }: { params: { photoId: string } },
) {
  try {
    const promoterId = request.headers.get('x-promoter-id');
    if (!promoterId) {
      return NextResponse.json(
        { error: 'UNAUTHORIZED', message: 'Chybí identifikace promotéra.' },
        { status: 401 },
      );
    }
    const db = getDb();
    await deletePhoto(params.photoId, promoterId, db);
    return new NextResponse(null, { status: 204 });
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
