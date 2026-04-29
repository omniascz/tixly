import { NextRequest, NextResponse } from 'next/server';
import {
  createSession,
  listSessions,
  type SessionDB,
  type CreateSessionInput,
  type SessionType,
} from '../../../../../services/session.service';
import { isConferenceError } from '../../../../../lib/conference-errors';

export async function GET(
  request: NextRequest,
  { params, db }: { params: { conferenceId: string }; db?: SessionDB },
): Promise<NextResponse> {
  const resolvedDb = db ?? getProductionDb();
  const { searchParams } = request.nextUrl;

  try {
    const sessions = await listSessions(
      params.conferenceId,
      {
        dayId: searchParams.get('day_id') ?? undefined,
        trackId: searchParams.get('track_id') ?? undefined,
        sessionType: (searchParams.get('session_type') ?? undefined) as SessionType | undefined,
      },
      resolvedDb,
    );
    return NextResponse.json(sessions);
  } catch (err) {
    if (isConferenceError(err)) return NextResponse.json(err.toHttpError(), { status: err.statusCode });
    throw err;
  }
}

export async function POST(
  request: NextRequest,
  { params, db }: { params: { conferenceId: string }; db?: SessionDB },
): Promise<NextResponse> {
  const resolvedDb = db ?? getProductionDb();
  try {
    const body = await request.json() as CreateSessionInput;
    const session = await createSession(params.conferenceId, body, resolvedDb);
    return NextResponse.json(session, { status: 201 });
  } catch (err) {
    if (isConferenceError(err)) return NextResponse.json(err.toHttpError(), { status: err.statusCode });
    throw err;
  }
}

function getProductionDb(): SessionDB {
  throw new Error('Production DB not configured. Use dependency injection.');
}
