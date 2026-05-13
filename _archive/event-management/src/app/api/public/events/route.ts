import { NextRequest, NextResponse } from 'next/server';
import { listPublicEvents } from '../../../../services/event.service';
import { EventManagementError } from '../../../../lib/event-errors';
import type { ServiceDeps } from '../../../../lib/service-container';

// ---------------------------------------------------------------------------
// Deps factory — přepsatelná v testech
// ---------------------------------------------------------------------------
export let _getDeps: () => ServiceDeps = () => {
  throw new Error('DB adapter not configured — inject via _getDeps');
};

export function _setDeps(factory: () => ServiceDeps): void {
  _getDeps = factory;
}

// ---------------------------------------------------------------------------
// GET /api/public/events
// ---------------------------------------------------------------------------
export async function GET(request: NextRequest): Promise<NextResponse> {
  const { searchParams } = new URL(request.url);

  const category = searchParams.get('category') ?? undefined;
  const city = searchParams.get('city') ?? undefined;
  const search = searchParams.get('search') ?? undefined;
  const fromParam = searchParams.get('from');
  const toParam = searchParams.get('to');
  const limit = parseInt(searchParams.get('limit') ?? '20', 10);
  const offset = parseInt(searchParams.get('offset') ?? '0', 10);

  const from = fromParam ? new Date(fromParam) : undefined;
  const to = toParam ? new Date(toParam) : undefined;

  try {
    const result = await listPublicEvents(
      { category, city, from, to, search },
      { limit, offset },
      _getDeps(),
    );
    return NextResponse.json(result, { status: 200 });
  } catch (err) {
    if (err instanceof EventManagementError) {
      return NextResponse.json(err.toHttpError(), { status: err.statusCode });
    }
    throw err;
  }
}
