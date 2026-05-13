// ---------------------------------------------------------------------------
// POST /api/guest-list/[guestId]/check-in  — check in a guest (staff)
// ---------------------------------------------------------------------------

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { GuestListService } from '../../../../../services/guest-list.service.js';
import { toHttpError } from '../../../../../types/guest-list.types.js';
import { formatCheckInConfirmation } from '../../../../../lib/guest-list-validator.js';
import { getAdapters } from '../../../../../lib/adapters.js';

const CheckInBodySchema = z.object({
  staff_id: z.string().min(1),
});

export async function POST(
  request: NextRequest,
  { params }: { params: { guestId: string } },
): Promise<NextResponse> {
  const userId = request.headers.get('x-user-id');
  if (!userId) {
    return NextResponse.json({ error: 'Unauthorized', code: 'UNAUTHORIZED' }, { status: 401 });
  }

  try {
    const raw = await request.json();
    const parsed = CheckInBodySchema.safeParse(raw);
    if (!parsed.success) {
      return NextResponse.json(
        { error: 'Validation error', code: 'VALIDATION_ERROR', details: parsed.error.flatten() },
        { status: 400 },
      );
    }

    const { db } = getAdapters();
    const guest = await GuestListService.checkInGuest(params.guestId, parsed.data.staff_id, db);
    const confirmation = formatCheckInConfirmation(guest, 'cs');

    return NextResponse.json({ guest, confirmation }, { status: 200 });
  } catch (err) {
    const { status, body } = toHttpError(err);
    return NextResponse.json(body, { status });
  }
}
