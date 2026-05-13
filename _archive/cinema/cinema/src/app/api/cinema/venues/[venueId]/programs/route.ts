import { NextRequest, NextResponse } from 'next/server';
import { createProgram, getProgram } from '../../../../../../services/program.service';
import { isCinemaError } from '../../../../../../lib/cinema-errors';
import type { CinemaDB } from '../../../../../../services/venue.service';

export async function GET(
  request: NextRequest,
  { params, deps }: { params: { venueId: string }; deps?: { db: CinemaDB } },
): Promise<NextResponse> {
  const db = deps?.db ?? getProductionDb();
  const programId = request.nextUrl.searchParams.get('programId');

  if (!programId) {
    return NextResponse.json({ error: 'VALIDATION_ERROR', message: 'programId required' }, { status: 422 });
  }

  try {
    const program = await getProgram(programId, db);
    return NextResponse.json(program, { status: 200 });
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
    const program = await createProgram(params.venueId, body.weekStart, db);
    return NextResponse.json(program, { status: 201 });
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
