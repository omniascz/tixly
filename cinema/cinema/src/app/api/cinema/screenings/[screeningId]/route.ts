import { NextRequest, NextResponse } from 'next/server';
import { getScreening, updateScreening } from '../../../../../services/screening.service';
import { isCinemaError } from '../../../../../lib/cinema-errors';
import type { CinemaDB } from '../../../../../services/venue.service';

export async function GET(
  request: NextRequest,
  { params, deps }: { params: { screeningId: string }; deps?: { db: CinemaDB } },
): Promise<NextResponse> {
  const db = deps?.db ?? getProductionDb();

  try {
    const screening = await getScreening(params.screeningId, db);
    return NextResponse.json(screening, { status: 200 });
  } catch (err) {
    if (isCinemaError(err)) {
      return NextResponse.json(err.toHttpError(), { status: err.statusCode });
    }
    throw err;
  }
}

export async function PATCH(
  request: NextRequest,
  { params, deps }: { params: { screeningId: string }; deps?: { db: CinemaDB } },
): Promise<NextResponse> {
  const db = deps?.db ?? getProductionDb();

  try {
    const body = await request.json();
    const screening = await updateScreening(params.screeningId, body, db);
    return NextResponse.json(screening, { status: 200 });
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
