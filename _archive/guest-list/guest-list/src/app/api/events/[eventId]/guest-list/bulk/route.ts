// ---------------------------------------------------------------------------
// POST /api/events/[eventId]/guest-list/bulk  — bulk add guests (organizer)
// ---------------------------------------------------------------------------

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { GuestListService } from '../../../../../../services/guest-list.service.js';
import { toHttpError } from '../../../../../../types/guest-list.types.js';
import { getAdapters } from '../../../../../../lib/adapters.js';
import { parseGuestCsv, GuestListCsvError } from '../../../../../../lib/csv-parser.js';

// ---------------------------------------------------------------------------
// Zod schemas
// ---------------------------------------------------------------------------

const GuestTypeSchema = z.enum(['complimentary', 'press', 'vip', 'industry', 'promo', 'other']);

const BulkGuestItemSchema = z.object({
  name: z.string().min(1),
  email: z.string().email().optional(),
  phone: z.string().optional(),
  guest_type: GuestTypeSchema,
  plus_count: z.number().int().min(0).max(9).default(0),
  zone_access: z.array(z.string()).optional(),
  notes: z.string().optional(),
});

const BulkAddBodySchema = z.object({
  guests: z.array(BulkGuestItemSchema).min(1).max(500),
});

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

    const contentType = request.headers.get('content-type') || '';
    let inputs: Array<{
      name: string;
      email?: string;
      phone?: string;
      guestType: z.infer<typeof GuestTypeSchema>;
      plusCount: number;
      zoneAccess?: string[];
      notes?: string;
    }>;

    if (contentType.includes('text/csv')) {
      // Parse CSV
      const csvContent = await request.text();
      try {
        const parsedRows = parseGuestCsv(csvContent);
        inputs = parsedRows.map((row) => ({
          name: `${row.firstName} ${row.lastName}`,
          email: row.email,
          phone: row.phone,
          guestType: 'complimentary' as const,
          plusCount: 0,
        }));
      } catch (csvErr) {
        if (csvErr instanceof GuestListCsvError) {
          return NextResponse.json(
            { error: csvErr.message, code: 'CSV_PARSE_ERROR' },
            { status: 400 },
          );
        }
        throw csvErr;
      }
    } else {
      // Parse JSON
      const raw = await request.json();
      const parsed = BulkAddBodySchema.safeParse(raw);
      if (!parsed.success) {
        return NextResponse.json(
          { error: 'Validation error', code: 'VALIDATION_ERROR', details: parsed.error.flatten() },
          { status: 400 },
        );
      }

      inputs = parsed.data.guests.map((g) => ({
        name: g.name,
        email: g.email,
        phone: g.phone,
        guestType: g.guest_type,
        plusCount: g.plus_count,
        zoneAccess: g.zone_access,
        notes: g.notes,
      }));
    }

    const result = await GuestListService.bulkAddGuests(
      params.eventId,
      userId,
      inputs,
      db,
      kafka,
    );

    // 200 even on partial success; caller inspects `failed` array
    return NextResponse.json(result, { status: 200 });
  } catch (err) {
    const { status, body } = toHttpError(err);
    return NextResponse.json(body, { status });
  }
}
