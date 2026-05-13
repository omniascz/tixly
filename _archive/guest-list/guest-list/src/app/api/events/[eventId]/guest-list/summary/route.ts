// ---------------------------------------------------------------------------
// GET /api/events/[eventId]/guest-list/summary  — event summary (organizer/staff)
// ---------------------------------------------------------------------------

import { NextRequest, NextResponse } from 'next/server';
import { GuestListService } from '../../../../../../services/guest-list.service.js';
import { toHttpError } from '../../../../../../types/guest-list.types.js';
import { getAdapters } from '../../../../../../lib/adapters.js';

export async function GET(
  request: NextRequest,
  { params }: { params: { eventId: string } },
): Promise<NextResponse> {
  const userId = request.headers.get('x-user-id');
  if (!userId) {
    return NextResponse.json({ error: 'Unauthorized', code: 'UNAUTHORIZED' }, { status: 401 });
  }

  try {
    const { db } = getAdapters();

    // Organizer or any staff member with access to the event may view the summary.
    // Auth check: organizer ownership OR a staff-role header accepted by the platform.
    const isOrganizer = await db.checkOrganizerOwnership(params.eventId, userId);
    const isStaff = request.headers.get('x-user-role') === 'staff';

    if (!isOrganizer && !isStaff) {
      return NextResponse.json(
        { error: 'Forbidden', code: 'GUEST_LIST_UNAUTHORIZED' },
        { status: 403 },
      );
    }

    const summary = await GuestListService.getEventSummary(params.eventId, db);
    return NextResponse.json(summary);
  } catch (err) {
    const { status, body } = toHttpError(err);
    return NextResponse.json(body, { status });
  }
}
