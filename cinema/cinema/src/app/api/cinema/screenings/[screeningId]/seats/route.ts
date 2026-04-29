import { NextRequest, NextResponse } from 'next/server';
import { getAvailableSeats, reserveSeat } from '../../../../../../services/screening.service';
import { isCinemaError } from '../../../../../../lib/cinema-errors';
import type { CinemaDB } from '../../../../../../services/venue.service';

export async function GET(
  request: NextRequest,
  { params, deps }: { params: { screeningId: string }; deps?: { db: CinemaDB } },
): Promise<NextResponse> {
  const db = deps?.db ?? getProductionDb();

  try {
    const seats = await getAvailableSeats(params.screeningId, db);
    return NextResponse.json({ seats }, { status: 200 });
  } catch (err) {
    if (isCinemaError(err)) {
      return NextResponse.json(err.toHttpError(), { status: err.statusCode });
    }
    throw err;
  }
}

export async function POST(
  request: NextRequest,
  { params, deps }: { params: { screeningId: string }; deps?: { db: CinemaDB } },
): Promise<NextResponse> {
  const db = deps?.db ?? getProductionDb();

  try {
    const body = await request.json();
    const { rowLabel, seatNumber, orderId } = body;
    const seat = await reserveSeat(params.screeningId, rowLabel, seatNumber, orderId, db);
    return NextResponse.json(seat, { status: 200 });
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
