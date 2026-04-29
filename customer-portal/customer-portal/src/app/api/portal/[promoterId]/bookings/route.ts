import { NextRequest, NextResponse } from 'next/server';
import { getPastBookings } from '../../../../../services/dashboard.service';
import { isPortalError } from '../../../../../lib/portal-errors';

function getDb() {
  return {
    query: async <T>(_sql: string, _params?: unknown[]): Promise<{ rows: T[] }> => ({ rows: [] }),
    execute: async (_sql: string, _params?: unknown[]): Promise<void> => {},
  };
}

export async function GET(
  request: NextRequest,
  { params }: { params: { promoterId: string } },
) {
  try {
    const { searchParams } = new URL(request.url);
    const userId = searchParams.get('userId') ?? '';
    const filters = {
      promoterId: params.promoterId,
      dateFrom: searchParams.get('dateFrom') ?? undefined,
      dateTo: searchParams.get('dateTo') ?? undefined,
      status: searchParams.get('status') ?? undefined,
      limit: searchParams.has('limit') ? Number(searchParams.get('limit')) : undefined,
      offset: searchParams.has('offset') ? Number(searchParams.get('offset')) : undefined,
    };
    const db = getDb();
    const bookings = await getPastBookings(userId, filters, db);
    return NextResponse.json(bookings);
  } catch (err) {
    if (isPortalError(err)) {
      return NextResponse.json(err.toHttpError(), { status: err.statusCode });
    }
    return NextResponse.json({ error: 'INTERNAL_ERROR', message: 'Unexpected error' }, { status: 500 });
  }
}
