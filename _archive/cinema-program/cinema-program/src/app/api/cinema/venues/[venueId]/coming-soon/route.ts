import { NextRequest, NextResponse } from 'next/server';
import { listComingSoon } from '../../../../../../services/film-release.service';
import { isCinemaProgramError } from '../../../../../../lib/cinema-program-errors';

function getDb() {
  return {
    query: async <T>(_sql: string, _params?: unknown[]): Promise<{ rows: T[] }> => ({ rows: [] }),
    execute: async (_sql: string, _params?: unknown[]): Promise<void> => {},
  };
}

export async function GET(
  _request: NextRequest,
  { params }: { params: { venueId: string } },
) {
  try {
    const db = getDb();
    const films = await listComingSoon(params.venueId, db);
    return NextResponse.json({ films });
  } catch (err) {
    if (isCinemaProgramError(err)) {
      return NextResponse.json(err.toHttpError(), { status: err.statusCode });
    }
    return NextResponse.json({ error: 'INTERNAL_ERROR', message: 'Unexpected error' }, { status: 500 });
  }
}
