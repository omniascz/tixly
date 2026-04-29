// ---------------------------------------------------------------------------
// PATCH  /api/guest-list/[guestId]  — update guest (organizer)
// DELETE /api/guest-list/[guestId]  — cancel guest (organizer)
// ---------------------------------------------------------------------------

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { GuestListService } from '../../../../services/guest-list.service';
import { toHttpError } from '../../../../types/guest-list.types';
import { getAdapters } from '../../../../lib/adapters';

// ---------------------------------------------------------------------------
// Zod schemas
// ---------------------------------------------------------------------------

const PatchGuestBodySchema = z.object({
  notes: z.string().nullable().optional(),
  zone_access: z.array(z.string()).optional(),
  plus_count: z.number().int().min(0).max(9).optional(),
});

// ---------------------------------------------------------------------------
// PATCH
// ---------------------------------------------------------------------------

export async function PATCH(
  request: NextRequest,
  { params }: { params: { guestId: string } },
): Promise<NextResponse> {
  const userId = request.headers.get('x-user-id');
  if (!userId) {
    return NextResponse.json({ error: 'Unauthorized', code: 'UNAUTHORIZED' }, { status: 401 });
  }

  try {
    const raw = await request.json();
    const parsed = PatchGuestBodySchema.safeParse(raw);
    if (!parsed.success) {
      return NextResponse.json(
        { error: 'Validation error', code: 'VALIDATION_ERROR', details: parsed.error.flatten() },
        { status: 400 },
      );
    }

    const { db } = getAdapters();

    // Verify the guest exists and the caller owns the event
    const guest = await db.findGuest(params.guestId);
    if (!guest) {
      return NextResponse.json({ error: `Guest not found: ${params.guestId}`, code: 'GUEST_NOT_FOUND' }, { status: 404 });
    }

    const isOrganizer = await db.checkOrganizerOwnership(guest.event_id, userId);
    if (!isOrganizer) {
      return NextResponse.json(
        { error: 'Forbidden', code: 'GUEST_LIST_UNAUTHORIZED' },
        { status: 403 },
      );
    }

    const updates: Parameters<typeof db.updateGuest>[1] = {};
    if (parsed.data.notes !== undefined) updates.notes = parsed.data.notes;
    if (parsed.data.zone_access !== undefined) updates.zone_access = parsed.data.zone_access;
    if (parsed.data.plus_count !== undefined) {
      updates.plus_count = parsed.data.plus_count;
      updates.total_count = parsed.data.plus_count + 1;
    }

    const updated = await db.updateGuest(params.guestId, updates);
    return NextResponse.json(updated);
  } catch (err) {
    const { status, body } = toHttpError(err);
    return NextResponse.json(body, { status });
  }
}

// ---------------------------------------------------------------------------
// DELETE
// ---------------------------------------------------------------------------

export async function DELETE(
  request: NextRequest,
  { params }: { params: { guestId: string } },
): Promise<NextResponse> {
  const userId = request.headers.get('x-user-id');
  if (!userId) {
    return NextResponse.json({ error: 'Unauthorized', code: 'UNAUTHORIZED' }, { status: 401 });
  }

  try {
    const { db } = getAdapters();
    await GuestListService.removeGuest(params.guestId, userId, db);
    return new NextResponse(null, { status: 204 });
  } catch (err) {
    const { status, body } = toHttpError(err);
    return NextResponse.json(body, { status });
  }
}
