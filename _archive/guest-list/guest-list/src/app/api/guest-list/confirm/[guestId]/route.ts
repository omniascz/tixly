// ---------------------------------------------------------------------------
// POST /api/guest-list/confirm/[guestId]  — guest confirms attendance (public)
// No authentication required — the guest clicks a link from their invitation e-mail.
// ---------------------------------------------------------------------------

import { NextRequest, NextResponse } from 'next/server';
import { GuestListService } from '../../../../../services/guest-list.service';
import { toHttpError } from '../../../../../types/guest-list.types';
import { getAdapters } from '../../../../../lib/adapters';

export async function POST(
  _request: NextRequest,
  { params }: { params: { guestId: string } },
): Promise<NextResponse> {
  try {
    const { db } = getAdapters();
    const guest = await GuestListService.confirmAttendance(params.guestId, db);
    return NextResponse.json(guest, { status: 200 });
  } catch (err) {
    const { status, body } = toHttpError(err);
    return NextResponse.json(body, { status });
  }
}
