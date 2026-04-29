import { NextRequest, NextResponse } from 'next/server';
import {
  getSession,
  updateSession,
  deleteSession,
  type SessionDB,
  type UpdateSessionInput,
} from '../../../../../../services/session.service';
import { isConferenceError } from '../../../../../../lib/conference-errors';

export async function GET(
  _request: NextRequest,
  { params, db }: { params: { conferenceId: string; sessionId: string }; db?: SessionDB },
): Promise<NextResponse> {
  const resolvedDb = db ?? getProductionDb();
  try {
    const session = await getSession(params.sessionId, resolvedDb);
    return NextResponse.json(session);
  } catch (err) {
    if (isConferenceError(err)) return NextResponse.json(err.toHttpError(), { status: err.statusCode });
    throw err;
  }
}

export async function PATCH(
  request: NextRequest,
  { params, db }: { params: { conferenceId: string; sessionId: string }; db?: SessionDB },
): Promise<NextResponse> {
  const resolvedDb = db ?? getProductionDb();
  try {
    const body = await request.json() as UpdateSessionInput;
    const session = await updateSession(params.sessionId, body, resolvedDb);
    return NextResponse.json(session);
  } catch (err) {
    if (isConferenceError(err)) return NextResponse.json(err.toHttpError(), { status: err.statusCode });
    throw err;
  }
}

export async function DELETE(
  _request: NextRequest,
  { params, db }: { params: { conferenceId: string; sessionId: string }; db?: SessionDB },
): Promise<NextResponse> {
  const resolvedDb = db ?? getProductionDb();
  try {
    await deleteSession(params.sessionId, resolvedDb);
    return NextResponse.json({ deleted: true });
  } catch (err) {
    if (isConferenceError(err)) return NextResponse.json(err.toHttpError(), { status: err.statusCode });
    throw err;
  }
}

function getProductionDb(): SessionDB {
  throw new Error('Production DB not configured. Use dependency injection.');
}
