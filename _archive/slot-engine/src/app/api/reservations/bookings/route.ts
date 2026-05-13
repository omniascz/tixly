import { NextRequest, NextResponse } from 'next/server';
import { z, ZodError } from 'zod';
import { confirmBooking } from '../../../../services/booking.service';
import { isSlotError } from '../../../../lib/slot-errors';

// ---------------------------------------------------------------------------
// Validation schema
// ---------------------------------------------------------------------------
const ConfirmBookingSchema = z.object({
  holdId: z.string().uuid({ message: 'holdId musí být platné UUID.' }),
  orderId: z.string().uuid({ message: 'orderId musí být platné UUID.' }).optional(),
});

function getDb() {
  return {
    query: async <T>(_sql: string, _params?: unknown[]): Promise<{ rows: T[] }> => ({ rows: [] }),
    execute: async (_sql: string, _params?: unknown[]): Promise<void> => {},
  };
}

export async function POST(request: NextRequest) {
  try {
    const raw = await request.json();
    const body = ConfirmBookingSchema.parse(raw);
    const db = getDb();
    const booking = await confirmBooking(body.holdId, body.orderId ?? null, db);
    return NextResponse.json(booking, { status: 201 });
  } catch (err) {
    if (err instanceof ZodError) {
      return NextResponse.json(
        { error: 'VALIDATION_ERROR', message: 'Neplatná data požadavku.', details: err.errors },
        { status: 400 },
      );
    }
    if (isSlotError(err)) {
      return NextResponse.json(err.toHttpError(), { status: err.statusCode });
    }
    return NextResponse.json({ error: 'INTERNAL_ERROR', message: 'Neočekávaná chyba.' }, { status: 500 });
  }
}
