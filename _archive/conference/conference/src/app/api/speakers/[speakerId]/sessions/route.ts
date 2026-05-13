import { NextRequest, NextResponse } from 'next/server';
import {
  assignSpeakerToSession,
  removeSpeakerFromSession,
  type SpeakerDB,
} from '../../../../../services/speaker.service';
import { isConferenceError } from '../../../../../lib/conference-errors';

export async function POST(
  request: NextRequest,
  { params, db }: { params: { speakerId: string }; db?: SpeakerDB },
): Promise<NextResponse> {
  const resolvedDb = db ?? getProductionDb();
  try {
    const body = await request.json() as {
      sessionId: string;
      role: 'speaker' | 'moderator' | 'panelist';
      sortOrder?: number;
    };
    const assignment = await assignSpeakerToSession(
      body.sessionId,
      params.speakerId,
      body.role,
      body.sortOrder ?? 0,
      resolvedDb,
    );
    return NextResponse.json(assignment, { status: 201 });
  } catch (err) {
    if (isConferenceError(err)) return NextResponse.json(err.toHttpError(), { status: err.statusCode });
    throw err;
  }
}

export async function DELETE(
  request: NextRequest,
  { params, db }: { params: { speakerId: string }; db?: SpeakerDB },
): Promise<NextResponse> {
  const resolvedDb = db ?? getProductionDb();
  try {
    const body = await request.json() as { sessionId: string };
    await removeSpeakerFromSession(body.sessionId, params.speakerId, resolvedDb);
    return NextResponse.json({ removed: true });
  } catch (err) {
    if (isConferenceError(err)) return NextResponse.json(err.toHttpError(), { status: err.statusCode });
    throw err;
  }
}

function getProductionDb(): SpeakerDB {
  throw new Error('Production DB not configured. Use dependency injection.');
}
