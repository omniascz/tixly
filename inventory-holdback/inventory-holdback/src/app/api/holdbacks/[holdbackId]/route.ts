import { NextRequest, NextResponse } from 'next/server';
import { HoldbackService } from '../../../../services/holdback.service';
import { toHoldbackHttpError } from '../../../../types/holdback.types';
import type { HoldbackDbAdapter } from '../../../../services/holdback.service';

// ---------------------------------------------------------------------------
// Adapter factory — replace with real PostgreSQL adapter at the infra layer
// ---------------------------------------------------------------------------

function getDbAdapter(): HoldbackDbAdapter {
  throw new Error('DB adapter not configured — wire up via getServiceContainer()');
}

// ---------------------------------------------------------------------------
// GET /api/holdbacks/[holdbackId]
// Fetch holdback detail (organizer auth required)
// ---------------------------------------------------------------------------

export async function GET(
  request: NextRequest,
  { params }: { params: { holdbackId: string } },
): Promise<NextResponse> {
  const organizerId = request.headers.get('x-user-id');
  if (!organizerId) {
    return NextResponse.json(
      { error: 'Unauthorized', code: 'UNAUTHORIZED' },
      { status: 401 },
    );
  }

  try {
    const db = getDbAdapter();
    const holdback = await db.getHoldback(params.holdbackId);

    if (holdback === null) {
      return NextResponse.json(
        { error: `Holdback not found: ${params.holdbackId}`, code: 'HOLDBACK_NOT_FOUND' },
        { status: 404 },
      );
    }

    if (holdback.organizerId !== organizerId) {
      return NextResponse.json(
        { error: 'You do not have permission to view this holdback.', code: 'UNAUTHORIZED' },
        { status: 403 },
      );
    }

    return NextResponse.json(holdback, {
      headers: { 'Cache-Control': 'no-store' },
    });
  } catch (err) {
    const { status, body } = toHoldbackHttpError(err);
    return NextResponse.json(body, { status });
  }
}

// ---------------------------------------------------------------------------
// PATCH /api/holdbacks/[holdbackId]/release
// Release holdback (partial or full) — organizer auth required
//
// Body:
//   quantity?       number   — omit for full release
//   releaseToPublic boolean  — required
// ---------------------------------------------------------------------------

export async function PATCH(
  request: NextRequest,
  { params }: { params: { holdbackId: string } },
): Promise<NextResponse> {
  const organizerId = request.headers.get('x-user-id');
  if (!organizerId) {
    return NextResponse.json(
      { error: 'Unauthorized', code: 'UNAUTHORIZED' },
      { status: 401 },
    );
  }

  // Validate URL suffix: must be /release
  const url = new URL(request.url);
  if (!url.pathname.endsWith('/release')) {
    return NextResponse.json(
      { error: 'Not found', code: 'NOT_FOUND' },
      { status: 404 },
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

  if (typeof body !== 'object' || body === null) {
    return NextResponse.json(
      { error: 'Request body must be a JSON object', code: 'BAD_REQUEST' },
      { status: 400 },
    );
  }

  const b = body as Record<string, unknown>;

  const releaseToPublic = b['releaseToPublic'];
  const quantityRaw = b['quantity'];

  if (typeof releaseToPublic !== 'boolean') {
    return NextResponse.json(
      { error: 'releaseToPublic (boolean) is required', code: 'BAD_REQUEST' },
      { status: 400 },
    );
  }

  let quantity: number | undefined;
  if (quantityRaw !== undefined) {
    if (
      typeof quantityRaw !== 'number' ||
      !Number.isInteger(quantityRaw) ||
      quantityRaw <= 0
    ) {
      return NextResponse.json(
        { error: 'quantity must be a positive integer when provided', code: 'BAD_REQUEST' },
        { status: 400 },
      );
    }
    quantity = quantityRaw;
  }

  try {
    const service = new HoldbackService(getDbAdapter());
    const updated = await service.releaseHoldback(
      params.holdbackId,
      organizerId,
      { quantity, releaseToPublic, releasedBy: organizerId },
    );

    return NextResponse.json(updated);
  } catch (err) {
    const { status, body: errBody } = toHoldbackHttpError(err);
    return NextResponse.json(errBody, { status });
  }
}

// ---------------------------------------------------------------------------
// DELETE /api/holdbacks/[holdbackId]
// Cancel holdback — organizer auth required
// Cancellation returns all unreleased qty back to public remaining_qty.
// ---------------------------------------------------------------------------

export async function DELETE(
  request: NextRequest,
  { params }: { params: { holdbackId: string } },
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
    await service.cancelHoldback(params.holdbackId, organizerId);

    return new NextResponse(null, { status: 204 });
  } catch (err) {
    const { status, body } = toHoldbackHttpError(err);
    return NextResponse.json(body, { status });
  }
}
