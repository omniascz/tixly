import { NextRequest, NextResponse } from 'next/server';
import { getPublicEvent } from '../../../../../services/event.service';
import { EventManagementError } from '../../../../../lib/event-errors';
import type { ServiceDeps } from '../../../../../lib/service-container';

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
// GET /api/public/events/[eventId]
// ---------------------------------------------------------------------------
export async function GET(
  _request: NextRequest,
  { params }: { params: { eventId: string } },
): Promise<NextResponse> {
  const { eventId } = params;

  try {
    const event = await getPublicEvent(eventId, _getDeps());
    if (!event) {
      return NextResponse.json(
        { error: { code: 'EVENT_NOT_FOUND', message: 'Akce nebyla nalezena.' } },
        { status: 404 },
      );
    }
    return NextResponse.json(event, { status: 200 });
  } catch (err) {
    if (err instanceof EventManagementError) {
      return NextResponse.json(err.toHttpError(), { status: err.statusCode });
    }
    throw err;
  }
}
