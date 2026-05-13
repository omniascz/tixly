import { NextRequest, NextResponse } from 'next/server';
import { setRelease, getRelease } from '../../../../../../services/film-release.service';
import { isCinemaProgramError } from '../../../../../../lib/cinema-program-errors';

function getDb() {
  return {
    query: async <T>(_sql: string, _params?: unknown[]): Promise<{ rows: T[] }> => ({ rows: [] }),
    execute: async (_sql: string, _params?: unknown[]): Promise<void> => {},
  };
}

export async function GET(
  request: NextRequest,
  { params }: { params: { filmId: string } },
) {
  try {
    const { searchParams } = new URL(request.url);
    const venueId = searchParams.get('venueId');
    if (!venueId) {
      return NextResponse.json({ error: 'VALIDATION_ERROR', message: 'venueId is required' }, { status: 400 });
    }
    const db = getDb();
    const release = await getRelease(params.filmId, venueId, db);
    return NextResponse.json(release);
  } catch (err) {
    if (isCinemaProgramError(err)) {
      return NextResponse.json(err.toHttpError(), { status: err.statusCode });
    }
    return NextResponse.json({ error: 'INTERNAL_ERROR', message: 'Unexpected error' }, { status: 500 });
  }
}

export async function POST(
  request: NextRequest,
  { params }: { params: { filmId: string } },
) {
  try {
    const body = await request.json() as { venueId: string; [key: string]: unknown };
    const { venueId, ...input } = body;
    const db = getDb();
    const release = await setRelease(params.filmId, venueId, input as Parameters<typeof setRelease>[2], db);
    return NextResponse.json(release, { status: 201 });
  } catch (err) {
    if (isCinemaProgramError(err)) {
      return NextResponse.json(err.toHttpError(), { status: err.statusCode });
    }
    return NextResponse.json({ error: 'INTERNAL_ERROR', message: 'Unexpected error' }, { status: 500 });
  }
}

export async function PUT(
  request: NextRequest,
  { params }: { params: { filmId: string } },
) {
  try {
    const body = await request.json() as { venueId: string; [key: string]: unknown };
    const { venueId, ...input } = body;
    const db = getDb();
    const release = await setRelease(params.filmId, venueId, input as Parameters<typeof setRelease>[2], db);
    return NextResponse.json(release);
  } catch (err) {
    if (isCinemaProgramError(err)) {
      return NextResponse.json(err.toHttpError(), { status: err.statusCode });
    }
    return NextResponse.json({ error: 'INTERNAL_ERROR', message: 'Unexpected error' }, { status: 500 });
  }
}
