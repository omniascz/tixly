import { NextRequest, NextResponse } from 'next/server';
import { toHttpError } from '../../../../lib/resale-errors';
import { getServiceContainer } from '../../../../lib/service-container';

// ---------------------------------------------------------------------------
// DELETE /api/watchlist/[watchlistId] — remove entry from user's watchlist
// ---------------------------------------------------------------------------

export async function DELETE(
  request: NextRequest,
  { params }: { params: { watchlistId: string } },
): Promise<NextResponse> {
  const userId = request.headers.get('x-user-id');

  if (!userId) {
    return NextResponse.json({ error: 'Unauthorized', code: 'UNAUTHORIZED' }, { status: 401 });
  }

  try {
    const { watchlistService } = getServiceContainer();
    await watchlistService.removeFromWatchlist(userId, params.watchlistId);
    return new NextResponse(null, { status: 204 });
  } catch (err) {
    const { status, body } = toHttpError(err);
    return NextResponse.json(body, { status });
  }
}
