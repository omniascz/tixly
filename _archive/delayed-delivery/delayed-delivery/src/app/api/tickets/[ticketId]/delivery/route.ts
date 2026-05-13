import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { toDeliveryHttpError } from '../../../../../types/delayed-delivery.types';
import { DeliveryScheduleNotFoundError } from '../../../../../types/delayed-delivery.types';

// ---------------------------------------------------------------------------
// Response schema (buyer-facing — no internal fields)
// ---------------------------------------------------------------------------

const DeliveryStatusResponseSchema = z.object({
  status: z.enum(['pending', 'delivered', 'failed', 'cancelled']),
  deliver_at: z.string().nullable(),   // ISO 8601 or null
  channels: z.array(z.enum(['email', 'push', 'wallet', 'sms'])),
  delivered_at: z.string().nullable(), // ISO 8601 or null
});

type DeliveryStatusResponse = z.infer<typeof DeliveryStatusResponseSchema>;

// ---------------------------------------------------------------------------
// GET /api/tickets/[ticketId]/delivery
// ---------------------------------------------------------------------------
// Returns the delivery status of a purchased ticket.
// Caller must be authenticated; only the ticket owner may read their own status.
// Internal fields (retry_count, failed_at, schedule ID) are never exposed.

export async function GET(
  request: NextRequest,
  { params }: { params: { ticketId: string } },
): Promise<NextResponse> {
  // --- Auth: x-user-id header (set by API gateway / middleware) ---
  const userId = request.headers.get('x-user-id');
  if (!userId) {
    return NextResponse.json(
      { error: 'Unauthorized', code: 'UNAUTHORIZED' },
      { status: 401 },
    );
  }

  const { ticketId } = params;

  try {
    // NOTE: In production, inject a real DeliveryDbAdapter via DI / service container.
    // The import below is a placeholder — replace with your actual adapter.
    const { getDeliveryDbAdapter } = await import('../../../../../lib/delivery-db-adapter');
    const db = getDeliveryDbAdapter();

    // Ownership check: the DB adapter must verify that ticketId belongs to userId.
    const schedule = await db.findScheduleForOwner(ticketId, userId);

    if (!schedule) {
      throw new DeliveryScheduleNotFoundError(
        `No delivery schedule found for ticket ${ticketId}`,
      );
    }

    const response: DeliveryStatusResponse = {
      status: schedule.status,
      deliver_at: schedule.deliver_at ? schedule.deliver_at.toISOString() : null,
      channels: schedule.channels,
      delivered_at: schedule.delivered_at ? schedule.delivered_at.toISOString() : null,
    };

    return NextResponse.json(response, {
      headers: { 'Cache-Control': 'no-store' },
    });
  } catch (err) {
    const { status, body } = toDeliveryHttpError(err);
    return NextResponse.json(body, { status });
  }
}
