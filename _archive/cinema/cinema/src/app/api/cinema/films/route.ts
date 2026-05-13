import { NextRequest, NextResponse } from 'next/server';
import { createFilm, listFilms } from '../../../../services/film.service';
import { isCinemaError } from '../../../../lib/cinema-errors';
import type { CinemaDB } from '../../../../services/venue.service';

export async function GET(
  request: NextRequest,
  context?: { deps?: { db: CinemaDB } },
): Promise<NextResponse> {
  const db = context?.deps?.db ?? getProductionDb();
  const promoterId = request.headers.get('x-promoter-id');

  if (!promoterId) {
    return NextResponse.json({ error: 'UNAUTHORIZED', message: 'Promoter ID required' }, { status: 401 });
  }

  const sp = request.nextUrl.searchParams;
  const filters = {
    genre: sp.get('genre') ?? undefined,
    language: sp.get('language') ?? undefined,
    rating: sp.get('rating') ?? undefined,
  };

  try {
    const films = await listFilms(promoterId, filters, db);
    return NextResponse.json({ films }, { status: 200 });
  } catch (err) {
    if (isCinemaError(err)) {
      return NextResponse.json(err.toHttpError(), { status: err.statusCode });
    }
    throw err;
  }
}

export async function POST(
  request: NextRequest,
  context?: { deps?: { db: CinemaDB } },
): Promise<NextResponse> {
  const db = context?.deps?.db ?? getProductionDb();
  const promoterId = request.headers.get('x-promoter-id');

  if (!promoterId) {
    return NextResponse.json({ error: 'UNAUTHORIZED', message: 'Promoter ID required' }, { status: 401 });
  }

  try {
    const body = await request.json();
    const film = await createFilm(promoterId, body, db);
    return NextResponse.json(film, { status: 201 });
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
