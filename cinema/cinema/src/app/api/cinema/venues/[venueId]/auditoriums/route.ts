import { NextRequest, NextResponse } from 'next/server';
import { createAuditorium, listAuditoriums } from '../../../../../../services/venue.service';
import { isCinemaError } from '../../../../../../lib/cinema-errors';
import type { CinemaDB } from '../../../../../../services/venue.service';

export async function GET(
  request: NextRequest,
  { params, deps }: { params: { venueId: string }; deps?: { db: CinemaDB } },
): Promise<NextResponse> {
  const db = deps?.db ?? getProductionDb();

  try {
    const auditoriums = await listAuditoriums(params.venueId, db);
    return NextResponse.json({ auditoriums }, { status: 200 });
  } catch (err) {
    if (isCinemaError(err)) {
      return NextResponse.json(err.toHttpError(), { status: err.statusCode });
    }
    throw err;
  }
}

export async function POST(
  request: NextRequest,
  { params, deps }: { params: { venueId: string }; deps?: { db: CinemaDB } },
): Promise<NextResponse> {
  const db = deps?.db ?? getProductionDb();

  try {
    const body = await request.json();
    const auditorium = await createAuditorium(params.venueId, body, db);
    return NextResponse.json(auditorium, { status: 201 });
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
