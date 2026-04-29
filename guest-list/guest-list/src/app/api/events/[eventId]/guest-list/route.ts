// ---------------------------------------------------------------------------
// GET  /api/events/[eventId]/guest-list  — list guests (organizer)
// POST /api/events/[eventId]/guest-list  — add single guest (organizer)
// ---------------------------------------------------------------------------

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { GuestListService } from '../../../../../services/guest-list.service.js';
import { toHttpError } from '../../../../../types/guest-list.types.js';
import { getAdapters } from '../../../../../lib/adapters.js';

// ---------------------------------------------------------------------------
// Zod schemas
// ---------------------------------------------------------------------------

const GuestTypeSchema = z.enum(['complimentary', 'press', 'vip', 'industry', 'promo', 'other']);
const GuestStatusSchema = z.enum(['invited', 'confirmed', 'checked_in', 'no_show', 'cancelled']);

const AddGuestBodySchema = z.object({
  name: z.string().min(1),
  email: z.string().email().optional(),
  phone: z.string().optional(),
  guest_type: GuestTypeSchema,
  plus_count: z.number().int().min(0).max(9).default(0),
  zone_access: z.array(z.string()).optional(),
  notes: z.string().optional(),
});

// ---------------------------------------------------------------------------
// GET
// ---------------------------------------------------------------------------

export async function GET(
  request: NextRequest,
  { params }: { params: { eventId: string } },
): Promise<NextResponse> {
  const userId = request.headers.get('x-user-id');
  if (!userId) {
    return NextResponse.json({ error: 'Unauthorized', code: 'UNAUTHORIZED' }, { status: 401 });
  }

  try {
    const { db, kafka: _kafka } = getAdapters();
    const isOrganizer = await db.checkOrganizerOwnership(params.eventId, userId);
    if (!isOrganizer) {
      return NextResponse.json(
        { error: 'Forbidden', code: 'GUEST_LIST_UNAUTHORIZED' },
        { status: 403 },
      );
    }

    const { searchParams } = new URL(request.url);
    const statusParam = searchParams.get('status') ?? undefined;
    const typeParam = searchParams.get('type') ?? undefined;
    const query = searchParams.get('q') ?? '';

    const statusParsed = statusParam ? GuestStatusSchema.safeParse(statusParam) : null;
    const typeParsed = typeParam ? GuestTypeSchema.safeParse(typeParam) : null;

    if (statusParsed && !statusParsed.success) {
      return NextResponse.json({ error: 'Invalid status filter', code: 'VALIDATION_ERROR' }, { status: 400 });
    }
    if (typeParsed && !typeParsed.success) {
      return NextResponse.json({ error: 'Invalid type filter', code: 'VALIDATION_ERROR' }, { status: 400 });
    }

    if (query) {
      const result = await GuestListService.searchGuests(params.eventId, query, db);
      return NextResponse.json(result);
    }

    const guests = await db.listGuestsByEvent(params.eventId, {
      status: statusParsed?.data,
      type: typeParsed?.data,
    });

    return NextResponse.json({ guests, total: guests.length });
  } catch (err) {
    const { status, body } = toHttpError(err);
    return NextResponse.json(body, { status });
  }
}

// ---------------------------------------------------------------------------
// POST
// ---------------------------------------------------------------------------

export async function POST(
  request: NextRequest,
  { params }: { params: { eventId: string } },
): Promise<NextResponse> {
  const userId = request.headers.get('x-user-id');
  if (!userId) {
    return NextResponse.json({ error: 'Unauthorized', code: 'UNAUTHORIZED' }, { status: 401 });
  }

  try {
    const { db, kafka } = getAdapters();
    const isOrganizer = await db.checkOrganizerOwnership(params.eventId, userId);
    if (!isOrganizer) {
      return NextResponse.json(
        { error: 'Forbidden', code: 'GUEST_LIST_UNAUTHORIZED' },
        { status: 403 },
      );
    }

    const raw = await request.json();
    const parsed = AddGuestBodySchema.safeParse(raw);
    if (!parsed.success) {
      return NextResponse.json(
        { error: 'Validation error', code: 'VALIDATION_ERROR', details: parsed.error.flatten() },
        { status: 400 },
      );
    }

    const { name, email, phone, guest_type, plus_count, zone_access, notes } = parsed.data;

    const guest = await GuestListService.addGuest(
      params.eventId,
      userId,
      { name, email, phone, guestType: guest_type, plusCount: plus_count, zoneAccess: zone_access, notes },
      db,
      kafka,
    );

    return NextResponse.json(guest, { status: 201 });
  } catch (err) {
    const { status, body } = toHttpError(err);
    return NextResponse.json(body, { status });
  }
}
