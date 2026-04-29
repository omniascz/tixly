// GET    /api/group-orders/[orderId] — fetch order detail (leader or organizer)
// DELETE /api/group-orders/[orderId] — cancel an order (leader or organizer)

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { groupTicketService } from '../../../../services/group-ticket.service';
import type { GroupDbAdapter } from '../../../../services/group-ticket.service';
import { groupErrorToHttp } from '../../../../types/group-ticket.types';

// ---------------------------------------------------------------------------
// Optional query-param schema for DELETE (organizer identification)
// ---------------------------------------------------------------------------

const DeleteQuerySchema = z.object({
  organizer_id: z.string().uuid().optional(),
});

// ---------------------------------------------------------------------------
// DB adapter factory — replace with real adapter from your service container
// ---------------------------------------------------------------------------

function getDbAdapter(): GroupDbAdapter {
  throw new Error(
    'getDbAdapter() is not implemented. Wire a real GroupDbAdapter from your service container.',
  );
}

// ---------------------------------------------------------------------------
// GET /api/group-orders/[orderId]
// ---------------------------------------------------------------------------

export async function GET(
  request: NextRequest,
  { params }: { params: { orderId: string } },
): Promise<NextResponse> {
  const userId = request.headers.get('x-user-id');
  if (!userId) {
    return NextResponse.json(
      { error: 'Unauthorized', code: 'UNAUTHORIZED' },
      { status: 401 },
    );
  }

  const { orderId } = params;

  try {
    const db = getDbAdapter();
    const order = await groupTicketService.getGroupOrder(orderId, db);

    // Access control: only the group leader or an organizer may view the order.
    // The organizer role is signalled via the x-organizer-id header (set by the
    // API gateway after verifying event ownership).
    const organizerId = request.headers.get('x-organizer-id');
    const isLeader = order.leader_user_id === userId;
    const isOrganizer = organizerId !== null;

    if (!isLeader && !isOrganizer) {
      return NextResponse.json(
        { error: 'Forbidden', code: 'GROUP_UNAUTHORIZED' },
        { status: 403 },
      );
    }

    return NextResponse.json(order);
  } catch (err) {
    const { status, body } = groupErrorToHttp(err);
    return NextResponse.json(body, { status });
  }
}

// ---------------------------------------------------------------------------
// DELETE /api/group-orders/[orderId]
// ---------------------------------------------------------------------------

export async function DELETE(
  request: NextRequest,
  { params }: { params: { orderId: string } },
): Promise<NextResponse> {
  const userId = request.headers.get('x-user-id');
  if (!userId) {
    return NextResponse.json(
      { error: 'Unauthorized', code: 'UNAUTHORIZED' },
      { status: 401 },
    );
  }

  const { orderId } = params;

  // Optional: organizer may pass their ID as a query param or header to bypass
  // leader-only restriction.
  const organizerId = request.headers.get('x-organizer-id') ?? undefined;

  // Also accept as query param for clients that cannot set custom headers
  const queryParseResult = DeleteQuerySchema.safeParse(
    Object.fromEntries(request.nextUrl.searchParams),
  );
  const resolvedOrganizerId =
    organizerId ??
    (queryParseResult.success ? queryParseResult.data.organizer_id : undefined);

  try {
    const db = getDbAdapter();
    await groupTicketService.cancelGroupOrder(
      orderId,
      userId,
      db,
      resolvedOrganizerId,
    );

    return new NextResponse(null, { status: 204 });
  } catch (err) {
    const { status, body } = groupErrorToHttp(err);
    return NextResponse.json(body, { status });
  }
}
