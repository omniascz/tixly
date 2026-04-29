import { NextRequest, NextResponse } from 'next/server';
import { checkAgeForScreening, hasVerification } from '../../../../../../services/age-restriction.service';
import { isCinemaProgramError } from '../../../../../../lib/cinema-program-errors';

function getDb() {
  return {
    query: async <T>(_sql: string, _params?: unknown[]): Promise<{ rows: T[] }> => ({ rows: [] }),
    execute: async (_sql: string, _params?: unknown[]): Promise<void> => {},
  };
}

export async function POST(
  request: NextRequest,
  { params }: { params: { screeningId: string } },
) {
  try {
    const body = await request.json() as {
      userId: string;
      birthDate: string;
      method?: 'self_declared' | 'bankid' | 'ocr';
    };
    const db = getDb();
    const result = await checkAgeForScreening(
      params.screeningId,
      body.userId,
      body.birthDate,
      body.method ?? 'self_declared',
      db,
    );
    return NextResponse.json(result);
  } catch (err) {
    if (isCinemaProgramError(err)) {
      return NextResponse.json(err.toHttpError(), { status: err.statusCode });
    }
    return NextResponse.json({ error: 'INTERNAL_ERROR', message: 'Unexpected error' }, { status: 500 });
  }
}

export async function GET(
  request: NextRequest,
  { params }: { params: { screeningId: string } },
) {
  try {
    const { searchParams } = new URL(request.url);
    const userId = searchParams.get('userId');
    if (!userId) {
      return NextResponse.json({ error: 'VALIDATION_ERROR', message: 'userId is required' }, { status: 400 });
    }
    const db = getDb();
    const verified = await hasVerification(params.screeningId, userId, db);
    return NextResponse.json({ verified });
  } catch (err) {
    if (isCinemaProgramError(err)) {
      return NextResponse.json(err.toHttpError(), { status: err.statusCode });
    }
    return NextResponse.json({ error: 'INTERNAL_ERROR', message: 'Unexpected error' }, { status: 500 });
  }
}
