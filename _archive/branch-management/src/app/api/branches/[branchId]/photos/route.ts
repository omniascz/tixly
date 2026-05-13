import { NextRequest, NextResponse } from 'next/server';
import {
  listPhotos,
  uploadPhoto,
} from '../../../../../services/branch-photos.service';
import { isBranchError } from '../../../../../lib/branch-errors';

function getDb() {
  return {
    query: async <T>(_sql: string, _params?: unknown[]): Promise<{ rows: T[] }> => ({ rows: [] }),
    execute: async (_sql: string, _params?: unknown[]): Promise<void> => {},
  };
}

function getPromoterId(req: NextRequest): string | null {
  return req.headers.get('x-promoter-id');
}

function getUserId(req: NextRequest): string | null {
  return req.headers.get('x-user-id');
}

export async function GET(
  request: NextRequest,
  { params }: { params: { branchId: string } },
) {
  try {
    const promoterId = getPromoterId(request);
    if (!promoterId) {
      return NextResponse.json(
        { error: 'UNAUTHORIZED', message: 'Chybí identifikace promotéra.' },
        { status: 401 },
      );
    }
    const db = getDb();
    const photos = await listPhotos(params.branchId, promoterId, db);
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

export async function POST(
  request: NextRequest,
  { params }: { params: { branchId: string } },
) {
  try {
    const promoterId = getPromoterId(request);
    const userId = getUserId(request);
    if (!promoterId || !userId) {
      return NextResponse.json(
        { error: 'UNAUTHORIZED', message: 'Chybí autentizace.' },
        { status: 401 },
      );
    }
    const body = await request.json();
    const db = getDb();
    const photo = await uploadPhoto(
      promoterId,
      {
        branchId: params.branchId,
        url: body.url,
        alt: body.alt,
        category: body.category,
        caption: body.caption,
        position: body.position,
      },
      userId,
      db,
    );
    return NextResponse.json(photo, { status: 201 });
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
