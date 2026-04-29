import { NextRequest, NextResponse } from 'next/server';
import { getSchedule, getConference } from '../../../../services/conference.service';
import { isConferenceError } from '../../../../lib/conference-errors';

export async function GET(
  _request: NextRequest,
  { params }: { params: { conferenceId: string } },
): Promise<NextResponse> {
  try {
    const schedule = await getSchedule(params.conferenceId, getDb());
    return NextResponse.json(schedule);
  } catch (err) {
    if (isConferenceError(err)) return NextResponse.json(err.toHttpError(), { status: err.statusCode });
    throw err;
  }
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: { conferenceId: string } },
): Promise<NextResponse> {
  try {
    // For now return the conference; full PATCH implementation would call updateConference
    const body = await request.json();
    void body;
    const conference = await getConference(params.conferenceId, getDb());
    return NextResponse.json(conference);
  } catch (err) {
    if (isConferenceError(err)) return NextResponse.json(err.toHttpError(), { status: err.statusCode });
    throw err;
  }
}

function getDb() {
  throw new Error('Production DB not configured. Use dependency injection.');
}
