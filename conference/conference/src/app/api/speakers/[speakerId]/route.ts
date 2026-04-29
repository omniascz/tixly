import { NextRequest, NextResponse } from 'next/server';
import {
  getSpeaker,
  updateSpeaker,
  type SpeakerDB,
  type UpdateSpeakerInput,
} from '../../../../services/speaker.service';
import { isConferenceError } from '../../../../lib/conference-errors';

export async function GET(
  _request: NextRequest,
  { params, db }: { params: { speakerId: string }; db?: SpeakerDB },
): Promise<NextResponse> {
  const resolvedDb = db ?? getProductionDb();
  try {
    const speaker = await getSpeaker(params.speakerId, resolvedDb);
    return NextResponse.json(speaker);
  } catch (err) {
    if (isConferenceError(err)) return NextResponse.json(err.toHttpError(), { status: err.statusCode });
    throw err;
  }
}

export async function PATCH(
  request: NextRequest,
  { params, db }: { params: { speakerId: string }; db?: SpeakerDB },
): Promise<NextResponse> {
  const resolvedDb = db ?? getProductionDb();
  try {
    const body = await request.json() as UpdateSpeakerInput;
    const speaker = await updateSpeaker(params.speakerId, body, resolvedDb);
    return NextResponse.json(speaker);
  } catch (err) {
    if (isConferenceError(err)) return NextResponse.json(err.toHttpError(), { status: err.statusCode });
    throw err;
  }
}

function getProductionDb(): SpeakerDB {
  throw new Error('Production DB not configured. Use dependency injection.');
}
