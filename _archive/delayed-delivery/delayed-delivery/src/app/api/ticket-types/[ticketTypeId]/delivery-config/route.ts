import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { toDeliveryHttpError } from '../../../../../types/delayed-delivery.types';
import {
  DeliveryConfigNotFoundError,
  DeliveryInvalidConfigError,
} from '../../../../../types/delayed-delivery.types';
import { validateDeliveryConfig } from '../../../../../lib/delivery-calculator';
import type { DeliveryConfig } from '../../../../../types/delayed-delivery.types';

// ---------------------------------------------------------------------------
// Zod schemas
// ---------------------------------------------------------------------------

const DeliveryChannelSchema = z.enum(['email', 'push', 'wallet', 'sms']);

const DeliveryConfigPutBodySchema = z
  .object({
    delivery_type: z.enum(['timed', 'manual', 'immediate']),
    hours_before: z.number().int().positive().nullable().optional(),
    channels: z.array(DeliveryChannelSchema).min(1),
    active: z.boolean(),
  })
  .refine(
    (data) => {
      if (data.delivery_type === 'timed') {
        return data.hours_before !== null && data.hours_before !== undefined;
      }
      return true;
    },
    { message: 'hours_before is required for timed delivery type', path: ['hours_before'] },
  );

const DeliveryConfigResponseSchema = z.object({
  ticket_type_id: z.string(),
  delivery_type: z.enum(['timed', 'manual', 'immediate']),
  hours_before: z.number().nullable(),
  channels: z.array(DeliveryChannelSchema),
  active: z.boolean(),
});

type DeliveryConfigResponse = z.infer<typeof DeliveryConfigResponseSchema>;

// ---------------------------------------------------------------------------
// Helper — map domain object to response shape
// ---------------------------------------------------------------------------

function toResponse(config: DeliveryConfig): DeliveryConfigResponse {
  return {
    ticket_type_id: config.ticket_type_id,
    delivery_type: config.delivery_type,
    hours_before: config.hours_before,
    channels: config.channels,
    active: config.active,
  };
}

// ---------------------------------------------------------------------------
// GET /api/ticket-types/[ticketTypeId]/delivery-config
// ---------------------------------------------------------------------------
// Returns the current delivery config for a ticket type.
// Organiser-only endpoint.

export async function GET(
  request: NextRequest,
  { params }: { params: { ticketTypeId: string } },
): Promise<NextResponse> {
  const organizerId = request.headers.get('x-organizer-id');
  if (!organizerId) {
    return NextResponse.json(
      { error: 'Forbidden — organiser authentication required', code: 'FORBIDDEN' },
      { status: 403 },
    );
  }

  const { ticketTypeId } = params;

  try {
    const { getDeliveryDbAdapter } = await import('../../../../../lib/delivery-db-adapter');
    const db = getDeliveryDbAdapter();

    const config = await db.findDeliveryConfig(ticketTypeId);
    if (!config) {
      throw new DeliveryConfigNotFoundError(
        `No delivery config found for ticket type ${ticketTypeId}`,
      );
    }

    return NextResponse.json(toResponse(config), {
      headers: { 'Cache-Control': 'no-store' },
    });
  } catch (err) {
    const { status, body } = toDeliveryHttpError(err);
    return NextResponse.json(body, { status });
  }
}

// ---------------------------------------------------------------------------
// PUT /api/ticket-types/[ticketTypeId]/delivery-config
// ---------------------------------------------------------------------------
// Create or replace the delivery config for a ticket type.
// Organiser-only endpoint.

export async function PUT(
  request: NextRequest,
  { params }: { params: { ticketTypeId: string } },
): Promise<NextResponse> {
  const organizerId = request.headers.get('x-organizer-id');
  if (!organizerId) {
    return NextResponse.json(
      { error: 'Forbidden — organiser authentication required', code: 'FORBIDDEN' },
      { status: 403 },
    );
  }

  const { ticketTypeId } = params;

  // --- Parse + validate ---
  let parsed: z.infer<typeof DeliveryConfigPutBodySchema>;
  try {
    const raw: unknown = await request.json();
    parsed = DeliveryConfigPutBodySchema.parse(raw);
  } catch (err) {
    if (err instanceof z.ZodError) {
      return NextResponse.json(
        { error: 'Invalid request body', code: 'VALIDATION_ERROR', details: err.errors },
        { status: 422 },
      );
    }
    return NextResponse.json(
      { error: 'Could not parse request body', code: 'BAD_REQUEST' },
      { status: 400 },
    );
  }

  const config: DeliveryConfig = {
    ticket_type_id: ticketTypeId,
    delivery_type: parsed.delivery_type,
    hours_before: parsed.hours_before ?? null,
    channels: parsed.channels,
    active: parsed.active,
  };

  // Domain-level validation (belt-and-suspenders on top of Zod)
  try {
    validateDeliveryConfig(config);
  } catch (err) {
    if (err instanceof DeliveryInvalidConfigError) {
      const { status, body } = toDeliveryHttpError(err);
      return NextResponse.json(body, { status });
    }
    throw err;
  }

  try {
    const { getDeliveryDbAdapter } = await import('../../../../../lib/delivery-db-adapter');
    const db = getDeliveryDbAdapter();

    const saved = await db.upsertDeliveryConfig(config);

    return NextResponse.json(toResponse(saved), {
      status: 200,
      headers: { 'Cache-Control': 'no-store' },
    });
  } catch (err) {
    const { status, body } = toDeliveryHttpError(err);
    return NextResponse.json(body, { status });
  }
}
