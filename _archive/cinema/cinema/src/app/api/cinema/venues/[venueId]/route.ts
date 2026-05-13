import { NextRequest, NextResponse } from 'next/server';
import { getVenue } from '../../../../../services/venue.service';
import { isCinemaError } from '../../../../../lib/cinema-errors';
import type { CinemaDB } from '../../../../../services/venue.service';

export async function GET(
  request: NextRequest,
  { params, deps }: { params: { venueId: string }; deps?: { db: CinemaDB } },
): Promise<NextResponse> {
  const db = deps?.db ?? getProductionDb();

  try {
    const venue = await getVenue(params.venueId, db);
    return NextResponse.json(venue, { status: 200 });
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
