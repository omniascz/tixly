import { NextRequest, NextResponse } from 'next/server';
import { unpublishEvent } from '../../../../../../../services/event.service';
import { EventManagementError } from '../../../../../../../lib/event-errors';
import type { ServiceDeps } from '../../../../../../../lib/service-container';

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
// POST /api/promoters/[promoterId]/events/[eventId]/unpublish
// ---------------------------------------------------------------------------
export async function POST(
  request: NextRequest,
  { params }: { params: { promoterId: string; eventId: string } },
): Promise<NextResponse> {
  const userId = request.headers.get('x-user-id');
  if (!userId) {
    return NextResponse.json(
      { error: { code: 'UNAUTHORIZED', message: 'Chybí x-user-id header.' } },
      { status: 401 },
    );
  }

  const { promoterId, eventId } = params;

  try {
    const event = await unpublishEvent(eventId, promoterId, _getDeps());
    return NextResponse.json(event, { status: 200 });
  } catch (err) {
    if (err instanceof EventManagementError) {
      return NextResponse.json(err.toHttpError(), { status: err.statusCode });
    }
    throw err;
  }
}
