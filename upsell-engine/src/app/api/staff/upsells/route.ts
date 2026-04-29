import { NextRequest, NextResponse } from 'next/server';
import { addUpsellsToOrder } from '../../../../services/upsell.service.js';
import { UpsellError } from '../../../../lib/upsell-errors.js';
import { staffUpsellSchema } from '../../../../lib/zod-schemas.js';
import type { ServiceDeps } from '../../../../lib/service-container.js';

declare function getServiceDeps(): ServiceDeps;

export async function POST(
  request: NextRequest,
): Promise<NextResponse> {
  try {
    const staffId = request.headers.get('x-staff-id');
    const eventId = request.headers.get('x-event-id');

    if (!staffId || !eventId) {
      return NextResponse.json(
        { error: { code: 'UNAUTHORIZED', message: 'x-staff-id and x-event-id headers required' } },
        { status: 401 },
      );
    }

    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return NextResponse.json(
        { error: { code: 'VALIDATION_ERROR', message: 'Invalid JSON body' } },
        { status: 400 },
      );
    }

    const parsed = staffUpsellSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: { code: 'VALIDATION_ERROR', message: parsed.error.message } },
        { status: 400 },
      );
    }

    const deps = getServiceDeps();

    // Staff uses ticketId as the orderId context via a synthetic order lookup
    // In production, derive orderId from ticketId
    const ticketRows = await deps.db.query<{ order_id: string }>(
      `SELECT order_id FROM tickets WHERE id = $1`,
      [parsed.data.ticketId],
    );

    if (ticketRows.length === 0) {
      return NextResponse.json(
        { error: { code: 'ORDER_NOT_FOUND', message: 'Ticket not found' } },
        { status: 404 },
      );
    }

    const orderId = ticketRows[0].order_id;

    const result = await addUpsellsToOrder(
      orderId,
      [
        {
          upsellItemId: parsed.data.upsellItemId,
          quantity: parsed.data.quantity,
          ticketId: parsed.data.ticketId,
          variantMetadata: parsed.data.offlineCreatedAt
            ? { offlineCreatedAt: parsed.data.offlineCreatedAt, staffId: parsed.data.staffId }
            : { staffId: parsed.data.staffId },
        },
      ],
      parsed.data.idempotencyKey,
      staffId,
      deps,
    );

    return NextResponse.json(result.orderItems, { status: 201 });
  } catch (err) {
    if (err instanceof UpsellError) {
      return NextResponse.json(err.toHttpError(), { status: err.statusCode });
    }
    return NextResponse.json(
      { error: { code: 'INTERNAL_ERROR', message: 'Internal server error' } },
      { status: 500 },
    );
  }
}
