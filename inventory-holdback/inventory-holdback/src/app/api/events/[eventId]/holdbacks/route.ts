import { NextRequest, NextResponse } from 'next/server';
import { HoldbackService } from '../../../../../services/holdback.service';
import { HoldbackReleaseType } from '../../../../../types/holdback.types';
import { toHoldbackHttpError, InvalidHoldbackConfigError } from '../../../../../types/holdback.types';
import type { HoldbackDbAdapter } from '../../../../../services/holdback.service';

// ---------------------------------------------------------------------------
// Adapter factory — replace with real PostgreSQL adapter at the infra layer
// ---------------------------------------------------------------------------

function getDbAdapter(): HoldbackDbAdapter {
  // Injected at application startup via a service container or DI framework.
  // This stub is replaced by the real adapter before deployment.
  throw new Error('DB adapter not configured — wire up via getServiceContainer()');
}

// ---------------------------------------------------------------------------
// GET /api/events/[eventId]/holdbacks
// List all holdbacks for an event (organizer auth required)
// ---------------------------------------------------------------------------

export async function GET(
  request: NextRequest,
  { params }: { params: { eventId: string } },
): Promise<NextResponse> {
  const organizerId = request.headers.get('x-user-id');
  if (!organizerId) {
    return NextResponse.json(
      { error: 'Unauthorized', code: 'UNAUTHORIZED' },
      { status: 401 },
    );
  }

  try {
    const service = new HoldbackService(getDbAdapter());
    const summary = await service.getEventHoldbacks(params.eventId, organizerId);

    return NextResponse.json(summary, {
      headers: { 'Cache-Control': 'no-store' },
    });
  } catch (err) {
    const { status, body } = toHoldbackHttpError(err);
    return NextResponse.json(body, { status });
  }
}

// ---------------------------------------------------------------------------
// POST /api/events/[eventId]/holdbacks
// Create a new holdback (organizer auth required)
//
// Body:
//   ticketTypeId      string    required
//   name              string    required
//   quantity          number    required  (> 0)
//   releaseType       string    required  ('manual' | 'scheduled' | 'trigger')
//   releaseAt         string?   ISO8601   required when releaseType = 'scheduled'
//   releaseTriggerPct number?             required when releaseType = 'trigger'
//   accessCode        string?
//   notes             string?
// ---------------------------------------------------------------------------

export async function POST(
  request: NextRequest,
  { params }: { params: { eventId: string } },
): Promise<NextResponse> {
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
      { error: 'Invalid JSON body', code: 'BAD_REQUEST' },
      { status: 400 },
    );
  }

  // Basic shape validation
  if (
    typeof body !== 'object' ||
    body === null
  ) {
    return NextResponse.json(
      { error: 'Request body must be a JSON object', code: 'BAD_REQUEST' },
      { status: 400 },
    );
  }

  const b = body as Record<string, unknown>;

  const ticketTypeId = b['ticketTypeId'];
  const name = b['name'];
  const quantity = b['quantity'];
  const releaseTypeRaw = b['releaseType'];
  const releaseAtRaw = b['releaseAt'];
  const releaseTriggerPct = b['releaseTriggerPct'];
  const accessCode = b['accessCode'];
  const notes = b['notes'];

  // Required field validation
  if (typeof ticketTypeId !== 'string' || ticketTypeId.trim() === '') {
    return NextResponse.json(
      { error: 'ticketTypeId is required', code: 'BAD_REQUEST' },
      { status: 400 },
    );
  }
  if (typeof name !== 'string' || name.trim() === '') {
    return NextResponse.json(
      { error: 'name is required', code: 'BAD_REQUEST' },
      { status: 400 },
    );
  }
  if (
    typeof quantity !== 'number' ||
    !Number.isInteger(quantity) ||
    quantity <= 0
  ) {
    return NextResponse.json(
      { error: 'quantity must be a positive integer', code: 'BAD_REQUEST' },
      { status: 400 },
    );
  }

  const validReleaseTypes: string[] = [
    HoldbackReleaseType.Manual,
    HoldbackReleaseType.Scheduled,
    HoldbackReleaseType.Trigger,
  ];
  if (
    typeof releaseTypeRaw !== 'string' ||
    !validReleaseTypes.includes(releaseTypeRaw)
  ) {
    return NextResponse.json(
      {
        error: `releaseType must be one of: ${validReleaseTypes.join(', ')}`,
        code: 'BAD_REQUEST',
      },
      { status: 400 },
    );
  }

  const releaseType = releaseTypeRaw as HoldbackReleaseType;

  // Parse optional fields
  let releaseAt: Date | undefined;
  if (releaseAtRaw !== undefined) {
    if (typeof releaseAtRaw !== 'string') {
      return NextResponse.json(
        { error: 'releaseAt must be an ISO8601 date string', code: 'BAD_REQUEST' },
        { status: 400 },
      );
    }
    const parsed = new Date(releaseAtRaw);
    if (isNaN(parsed.getTime())) {
      return NextResponse.json(
        { error: 'releaseAt is not a valid date', code: 'BAD_REQUEST' },
        { status: 400 },
      );
    }
    releaseAt = parsed;
  }

  let triggerPct: number | undefined;
  if (releaseTriggerPct !== undefined) {
    if (typeof releaseTriggerPct !== 'number' || releaseTriggerPct <= 0 || releaseTriggerPct > 100) {
      return NextResponse.json(
        {
          error: 'releaseTriggerPct must be a number between 0.1 and 100',
          code: 'BAD_REQUEST',
        },
        { status: 400 },
      );
    }
    triggerPct = releaseTriggerPct;
  }

  try {
    // Validate scheduled/trigger config before hitting service
    if (releaseType === HoldbackReleaseType.Scheduled && releaseAt === undefined) {
      throw new InvalidHoldbackConfigError(
        "releaseType 'scheduled' requires releaseAt",
      );
    }
    if (releaseType === HoldbackReleaseType.Trigger && triggerPct === undefined) {
      throw new InvalidHoldbackConfigError(
        "releaseType 'trigger' requires releaseTriggerPct",
      );
    }

    const service = new HoldbackService(getDbAdapter());
    const holdback = await service.createHoldback({
      ticketTypeId,
      eventId: params.eventId,
      organizerId,
      name: name.trim(),
      quantity,
      releaseType,
      releaseAt,
      releaseTriggerPct: triggerPct,
      accessCode:
        typeof accessCode === 'string' && accessCode.trim() !== ''
          ? accessCode.trim()
          : undefined,
      notes:
        typeof notes === 'string' && notes.trim() !== ''
          ? notes.trim()
          : undefined,
    });

    return NextResponse.json(holdback, { status: 201 });
  } catch (err) {
    const { status, body: errBody } = toHoldbackHttpError(err);
    return NextResponse.json(errBody, { status });
  }
}
