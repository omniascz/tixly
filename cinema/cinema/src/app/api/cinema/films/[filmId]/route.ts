import { NextRequest, NextResponse } from 'next/server';
import { getFilm, updateFilm } from '../../../../../services/film.service';
import { isCinemaError } from '../../../../../lib/cinema-errors';
import type { CinemaDB } from '../../../../../services/venue.service';

export async function GET(
  request: NextRequest,
  { params, deps }: { params: { filmId: string }; deps?: { db: CinemaDB } },
): Promise<NextResponse> {
  const db = deps?.db ?? getProductionDb();

  try {
    const film = await getFilm(params.filmId, db);
    return NextResponse.json(film, { status: 200 });
  } catch (err) {
    if (isCinemaError(err)) {
      return NextResponse.json(err.toHttpError(), { status: err.statusCode });
    }
    throw err;
  }
}

export async function PATCH(
  request: NextRequest,
  { params, deps }: { params: { filmId: string }; deps?: { db: CinemaDB } },
): Promise<NextResponse> {
  const db = deps?.db ?? getProductionDb();

  try {
    const body = await request.json();
    const film = await updateFilm(params.filmId, body, db);
    return NextResponse.json(film, { status: 200 });
  } catch (err) {
    if (isCinemaError(err)) {
      return NextResponse.json(err.toHttpError(), { status: err.statusCode });
    }
    throw err;
  }
}

function getProductionDb(): CinemaDB {
  throw new Error('Production dependencies not configured. Use dependency injection.');
}
