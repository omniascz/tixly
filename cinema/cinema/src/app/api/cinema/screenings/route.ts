import { NextRequest, NextResponse } from 'next/server';
import { createScreening, listScreenings } from '../../../../services/screening.service';
import { isCinemaError } from '../../../../lib/cinema-errors';
import type { CinemaDB } from '../../../../services/venue.service';

export async function GET(
  request: NextRequest,
  context?: { deps?: { db: CinemaDB } },
): Promise<NextResponse> {
  const db = context?.deps?.db ?? getProductionDb();
  const sp = request.nextUrl.searchParams;

  const filters = {
    filmId: sp.get('filmId') ?? undefined,
    auditoriumId: sp.get('auditoriumId') ?? undefined,
    dateFrom: sp.get('dateFrom') ?? undefined,
    dateTo: sp.get('dateTo') ?? undefined,
    status: (sp.get('status') ?? undefined) as import('../../../../services/screening.service').ScreeningStatus | undefined,
  };

  try {
    const screenings = await listScreenings(filters, db);
    return NextResponse.json({ screenings }, { status: 200 });
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

  try {
    const body = await request.json();
    const screening = await createScreening(body, db);
    return NextResponse.json(screening, { status: 201 });
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
