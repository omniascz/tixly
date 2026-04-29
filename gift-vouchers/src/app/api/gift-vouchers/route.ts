// GET  /api/gift-vouchers  — list current user's vouchers
// POST /api/gift-vouchers  — purchase a new voucher

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { GiftVoucherService } from '../../../services/gift-voucher.service';
import { voucherErrorToHttp } from '../../../types/gift-voucher.types';
import { getDb } from '../../../lib/db';

// ---------------------------------------------------------------------------
// Zod schemas
// ---------------------------------------------------------------------------

const PurchaseVoucherSchema = z.object({
  type: z.enum(['value', 'event_specific', 'ticket']),
  /** Haléře; ignored for ticket type (ticket face value is used instead) */
  value: z.number().int().min(1),
  recipient_email: z.string().email().optional(),
  recipient_name: z.string().max(120).optional(),
  applicable_event_id: z.string().uuid().optional(),
  applicable_ticket_type_id: z.string().uuid().optional(),
  valid_until: z.string().datetime().optional(),
  personal_message: z.string().max(280).optional(),
  /** Haléře; required when type = 'ticket' */
  ticket_face_value: z.number().int().min(1).optional(),
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function getUserId(request: NextRequest): string | null {
  return request.headers.get('x-user-id');
}

const service = new GiftVoucherService();

// ---------------------------------------------------------------------------
// GET — list my vouchers
// ---------------------------------------------------------------------------

export async function GET(request: NextRequest): Promise<NextResponse> {
  const userId = getUserId(request);
  if (!userId) {
    return NextResponse.json({ error: 'Unauthorized', code: 'UNAUTHORIZED' }, { status: 401 });
  }

  try {
    const db = getDb();
    const vouchers = await service.listMyVouchers(userId, db);
    return NextResponse.json({ data: vouchers });
  } catch (err) {
    const { status, body } = voucherErrorToHttp(err);
    return NextResponse.json(body, { status });
  }
}

// ---------------------------------------------------------------------------
// POST — purchase a voucher
// ---------------------------------------------------------------------------

export async function POST(request: NextRequest): Promise<NextResponse> {
  const userId = getUserId(request);
  if (!userId) {
    return NextResponse.json({ error: 'Unauthorized', code: 'UNAUTHORIZED' }, { status: 401 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON', code: 'BAD_REQUEST' }, { status: 400 });
  }

  const parsed = PurchaseVoucherSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'Validation failed', code: 'VALIDATION_ERROR', details: parsed.error.flatten() },
      { status: 422 },
    );
  }

  const data = parsed.data;

  if (data.type === 'ticket' && data.ticket_face_value === undefined) {
    return NextResponse.json(
      { error: 'ticket_face_value is required for ticket-type vouchers', code: 'VALIDATION_ERROR' },
      { status: 422 },
    );
  }

  if (data.type === 'event_specific' && !data.applicable_event_id) {
    return NextResponse.json(
      { error: 'applicable_event_id is required for event_specific vouchers', code: 'VALIDATION_ERROR' },
      { status: 422 },
    );
  }

  if (data.type === 'ticket' && !data.applicable_ticket_type_id) {
    return NextResponse.json(
      { error: 'applicable_ticket_type_id is required for ticket-type vouchers', code: 'VALIDATION_ERROR' },
      { status: 422 },
    );
  }

  try {
    const db = getDb();
    const voucher = await service.purchaseVoucher(
      userId,
      {
        type: data.type,
        value: data.value,
        recipientEmail: data.recipient_email,
        recipientName: data.recipient_name,
        applicableEventId: data.applicable_event_id,
        applicableTicketTypeId: data.applicable_ticket_type_id,
        validUntil: data.valid_until ? new Date(data.valid_until) : undefined,
        personalMessage: data.personal_message,
        ticketFaceValue: data.ticket_face_value,
      },
      db,
    );

    return NextResponse.json({ data: voucher }, { status: 201 });
  } catch (err) {
    const { status, body } = voucherErrorToHttp(err);
    return NextResponse.json(body, { status });
  }
}
