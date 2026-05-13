import { NextRequest, NextResponse } from 'next/server';
import { getPublicProgram } from '../../../../../../services/program-view.service';
import { isCinemaProgramError } from '../../../../../../lib/cinema-program-errors';

// Placeholder DB adapter — in production, replace with real DB connection
function getDb() {
  return {
    query: async <T>(_sql: string, _params?: unknown[]): Promise<{ rows: T[] }> => ({ rows: [] }),
    execute: async (_sql: string, _params?: unknown[]): Promise<void> => {},
  };
}

export async function GET(
  request: NextRequest,
  { params }: { params: { venueId: string } },
) {
  try {
    const { venueId } = params;
    const { searchParams } = new URL(request.url);
    const dateFrom = searchParams.get('dateFrom') ?? new Date().toISOString();
    const dateTo = searchParams.get('dateTo') ?? (() => {
      const d = new Date();
      d.setDate(d.getDate() + 7);
      return d.toISOString();
    })();

    const db = getDb();
    const program = await getPublicProgram(venueId, dateFrom, dateTo, db);
    return NextResponse.json(program);
  } catch (err) {
    if (isCinemaProgramError(err)) {
      return NextResponse.json(err.toHttpError(), { status: err.statusCode });
    }
    return NextResponse.json({ error: 'INTERNAL_ERROR', message: 'Unexpected error' }, { status: 500 });
  }
}
