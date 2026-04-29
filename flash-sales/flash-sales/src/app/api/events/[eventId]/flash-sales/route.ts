import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { FlashSaleService } from '../../../../../services/flash-sale.service';
import { toHttpError } from '../../../../../types/flash-sale.types';
import { getServiceContainer } from '../../../../../lib/service-container';

const flashSaleService = new FlashSaleService();

// ---------------------------------------------------------------------------
// Input schema for POST
// ---------------------------------------------------------------------------

const CreateFlashSaleSchema = z.object({
  ticket_type_id: z.string().min(1),
  name: z.string().min(1).max(200),
  discount_type: z.enum(['percentage', 'fixed']),
  discount_value: z.number().int().positive(),
  flash_capacity: z.number().int().positive(),
  starts_at: z.string().datetime(),
  ends_at: z.string().datetime(),
});

// ---------------------------------------------------------------------------
// GET /api/events/[eventId]/flash-sales
// Public — returns active flash sales for the event as FlashSalePublicView[]
// ---------------------------------------------------------------------------

export async function GET(
  _request: NextRequest,
  { params }: { params: { eventId: string } },
): Promise<NextResponse> {
  try {
    const { db } = getServiceContainer();
    const views = await flashSaleService.getEventFlashSales(params.eventId, db);
    return NextResponse.json(views, {
      headers: { 'Cache-Control': 'no-store' },
    });
  } catch (err) {
    const { status, body } = toHttpError(err);
    return NextResponse.json(body, { status });
  }
}

// ---------------------------------------------------------------------------
// POST /api/events/[eventId]/flash-sales
// Organizer only — create a new flash sale for a ticket type in this event
// ---------------------------------------------------------------------------

export async function POST(
  request: NextRequest,
  { params }: { params: { eventId: string } },
): Promise<NextResponse> {
  // Auth: organizer identity comes from verified JWT middleware injecting the header
  const organizerId = request.headers.get('x-user-id');
  if (!organizerId) {
    return NextResponse.json(
      { error: 'Unauthorized', code: 'UNAUTHORIZED' },
      { status: 401 },
    );
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { error: 'Invalid JSON body', code: 'INVALID_JSON' },
      { status: 400 },
    );
  }

  const parsed = CreateFlashSaleSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      {
        error: 'Validation failed',
        code: 'VALIDATION_ERROR',
        details: parsed.error.flatten().fieldErrors,
      },
      { status: 422 },
    );
  }

  const input = parsed.data;

  try {
    const { db } = getServiceContainer();

    const sale = await flashSaleService.createFlashSale(
      input.ticket_type_id,
      organizerId,
      {
        eventId: params.eventId,
        name: input.name,
        discountType: input.discount_type,
        discountValue: input.discount_value,
        flashCapacity: input.flash_capacity,
        startsAt: new Date(input.starts_at),
        endsAt: new Date(input.ends_at),
      },
      db,
    );

    return NextResponse.json(sale, { status: 201 });
  } catch (err) {
    const { status, body: errBody } = toHttpError(err);
    return NextResponse.json(errBody, { status });
  }
}
