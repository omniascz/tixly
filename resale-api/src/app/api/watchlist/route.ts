import { NextRequest, NextResponse } from 'next/server';
import { toHttpError } from '../../../lib/resale-errors';
import { getServiceContainer } from '../../../lib/service-container';

// ---------------------------------------------------------------------------
// GET /api/watchlist — list authenticated user's watchlist entries
// ---------------------------------------------------------------------------

export async function GET(request: NextRequest): Promise<NextResponse> {
  const userId = request.headers.get('x-user-id');

  if (!userId) {
    return NextResponse.json({ error: 'Unauthorized', code: 'UNAUTHORIZED' }, { status: 401 });
  }

  try {
    const { watchlistService } = getServiceContainer();
    const entries = await watchlistService.getWatchlistForUser(userId);
    return NextResponse.json({ data: entries });
  } catch (err) {
    const { status, body } = toHttpError(err);
    return NextResponse.json(body, { status });
  }
}

// ---------------------------------------------------------------------------
// POST /api/watchlist — add event to watchlist
// ---------------------------------------------------------------------------

export async function POST(request: NextRequest): Promise<NextResponse> {
  const userId = request.headers.get('x-user-id');

  if (!userId) {
    return NextResponse.json({ error: 'Unauthorized', code: 'UNAUTHORIZED' }, { status: 401 });
  }

  try {
    const body = await request.json() as {
      eventId?: unknown;
      maxPrice?: unknown;
      zone?: unknown;
    };

    if (typeof body.eventId !== 'string') {
      return NextResponse.json(
        { error: 'eventId (string) is required', code: 'VALIDATION_ERROR' },
        { status: 400 },
      );
    }

    const maxPrice = typeof body.maxPrice === 'number' ? body.maxPrice : undefined;
    const zone = typeof body.zone === 'string' ? body.zone : undefined;

    const { watchlistService } = getServiceContainer();
    const entry = await watchlistService.addToWatchlist(userId, body.eventId, maxPrice, zone);

    return NextResponse.json(entry, { status: 201 });
  } catch (err) {
    const { status, body } = toHttpError(err);
    return NextResponse.json(body, { status });
  }
}
