import { NextRequest, NextResponse } from 'next/server';
import {
  createPass,
  listPasses,
  type PassDB,
  type CreatePassInput,
} from '../../../../../services/pass.service';
import { isConferenceError } from '../../../../../lib/conference-errors';

export async function GET(
  _request: NextRequest,
  { params, db }: { params: { conferenceId: string }; db?: PassDB },
): Promise<NextResponse> {
  const resolvedDb = db ?? getProductionDb();
  try {
    const passes = await listPasses(params.conferenceId, resolvedDb);
    return NextResponse.json(passes);
  } catch (err) {
    if (isConferenceError(err)) return NextResponse.json(err.toHttpError(), { status: err.statusCode });
    throw err;
  }
}

export async function POST(
  request: NextRequest,
  { params, db }: { params: { conferenceId: string }; db?: PassDB },
): Promise<NextResponse> {
  const resolvedDb = db ?? getProductionDb();
  try {
    const body = await request.json() as CreatePassInput;
    const pass = await createPass(params.conferenceId, body, resolvedDb);
    return NextResponse.json(pass, { status: 201 });
  } catch (err) {
    if (isConferenceError(err)) return NextResponse.json(err.toHttpError(), { status: err.statusCode });
    throw err;
  }
}

function getProductionDb(): PassDB {
  throw new Error('Production DB not configured. Use dependency injection.');
}
