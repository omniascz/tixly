import { NextRequest, NextResponse } from 'next/server';
import { createVenue, listVenues } from '../../../../services/venue.service';
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

  try {
    const venues = await listVenues(promoterId, db);
    return NextResponse.json({ venues }, { status: 200 });
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
    const venue = await createVenue(promoterId, body, db);
    return NextResponse.json(venue, { status: 201 });
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
