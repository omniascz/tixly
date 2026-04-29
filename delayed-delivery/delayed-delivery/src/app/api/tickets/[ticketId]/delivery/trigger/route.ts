import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { toDeliveryHttpError } from '../../../../../../types/delayed-delivery.types';
import { DelayedDeliveryService } from '../../../../../../services/delayed-delivery.service';

// ---------------------------------------------------------------------------
// Request body schema
// ---------------------------------------------------------------------------

const TriggerDeliveryBodySchema = z.object({
  /** Optional note from the organiser (stored for audit) */
  note: z.string().max(500).optional(),
});

// ---------------------------------------------------------------------------
// POST /api/tickets/[ticketId]/delivery/trigger
// ---------------------------------------------------------------------------
// Allows an organiser to manually trigger delivery of a pending ticket.
// Only works for schedules with delivery_type = 'manual' or any pending schedule.
// Requires organiser-level auth (x-organizer-id header set by middleware).

export async function POST(
  request: NextRequest,
  { params }: { params: { ticketId: string } },
): Promise<NextResponse> {
  // --- Auth: organiser must be identified ---
  const organizerId = request.headers.get('x-organizer-id');
  if (!organizerId) {
    return NextResponse.json(
      { error: 'Forbidden — organiser authentication required', code: 'FORBIDDEN' },
      { status: 403 },
    );
  }

  const { ticketId } = params;

  // --- Parse + validate body (optional) ---
  let _body: z.infer<typeof TriggerDeliveryBodySchema> = {};
  try {
    const raw: unknown = await request.json().catch(() => ({}));
    _body = TriggerDeliveryBodySchema.parse(raw);
  } catch (err) {
    if (err instanceof z.ZodError) {
      return NextResponse.json(
        { error: 'Invalid request body', code: 'VALIDATION_ERROR', details: err.errors },
        { status: 422 },
      );
    }
  }

  try {
    const { getDeliveryDbAdapter } = await import('../../../../../../lib/delivery-db-adapter');
    const { getKafkaProducer } = await import('../../../../../../lib/kafka-producer');

    const db = getDeliveryDbAdapter();
    const kafka = getKafkaProducer();
    const service = new DelayedDeliveryService();

    await service.triggerManualDelivery(ticketId, organizerId, db, kafka);

    return NextResponse.json(
      { message: 'Ticket delivery triggered successfully' },
      { status: 200, headers: { 'Cache-Control': 'no-store' } },
    );
  } catch (err) {
    const { status, body } = toDeliveryHttpError(err);
    return NextResponse.json(body, { status });
  }
}
