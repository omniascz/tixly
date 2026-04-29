import { NextRequest, NextResponse } from 'next/server';
import {
  createSpeaker,
  type SpeakerDB,
  type CreateSpeakerInput,
} from '../../../services/speaker.service';
import { isConferenceError } from '../../../lib/conference-errors';

export async function POST(
  request: NextRequest,
  { db }: { db?: SpeakerDB } = {},
): Promise<NextResponse> {
  const resolvedDb = db ?? getProductionDb();
  try {
    const body = await request.json() as { promoterId: string } & CreateSpeakerInput;
    const { promoterId, ...speakerInput } = body;
    const speaker = await createSpeaker(promoterId, speakerInput, resolvedDb);
    return NextResponse.json(speaker, { status: 201 });
  } catch (err) {
    if (isConferenceError(err)) return NextResponse.json(err.toHttpError(), { status: err.statusCode });
    throw err;
  }
}

function getProductionDb(): SpeakerDB {
  throw new Error('Production DB not configured. Use dependency injection.');
}
