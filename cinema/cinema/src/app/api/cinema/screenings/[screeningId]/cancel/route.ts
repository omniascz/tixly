import { NextRequest, NextResponse } from 'next/server';
import { cancelScreening } from '../../../../../../services/screening.service';
import { isCinemaError } from '../../../../../../lib/cinema-errors';
import type { CinemaDB } from '../../../../../../services/venue.service';

export async function POST(
  request: NextRequest,
  { params, deps }: { params: { screeningId: string }; deps?: { db: CinemaDB } },
): Promise<NextResponse> {
  const db = deps?.db ?? getProductionDb();

  try {
    await cancelScreening(params.screeningId, db);
    return NextResponse.json({ success: true }, { status: 200 });
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
