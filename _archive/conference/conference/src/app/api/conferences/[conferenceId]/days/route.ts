import { NextRequest, NextResponse } from 'next/server';
import { addDay, type ConferenceDB, type AddDayInput } from '../../../../../services/conference.service';
import { isConferenceError } from '../../../../../lib/conference-errors';

export async function POST(
  request: NextRequest,
  { params, db }: { params: { conferenceId: string }; db?: ConferenceDB },
): Promise<NextResponse> {
  const resolvedDb = db ?? getProductionDb();
  try {
    const body = await request.json() as AddDayInput;
    const day = await addDay(params.conferenceId, body, resolvedDb);
    return NextResponse.json(day, { status: 201 });
  } catch (err) {
    if (isConferenceError(err)) return NextResponse.json(err.toHttpError(), { status: err.statusCode });
    throw err;
  }
}

function getProductionDb(): ConferenceDB {
  throw new Error('Production DB not configured. Use dependency injection.');
}
