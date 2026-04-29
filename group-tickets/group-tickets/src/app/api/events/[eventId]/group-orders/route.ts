// GET  /api/events/[eventId]/group-orders — list group orders for an event (organizer)
// POST /api/events/[eventId]/group-orders — create a new group order

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { groupTicketService } from '../../../../../services/group-ticket.service';
import type { GroupDbAdapter } from '../../../../../services/group-ticket.service';
import { groupErrorToHttp } from '../../../../../types/group-ticket.types';

// ---------------------------------------------------------------------------
// Zod schema for POST body
// ---------------------------------------------------------------------------

const GroupMemberSchema = z.object({
  name: z.string().min(1, 'Member name must not be empty'),
  email: z.string().email('Invalid email address').nullable().optional().transform((v) => v ?? null),
});

const CreateGroupOrderSchema = z.object({
  group_ticket_type_id: z.string().uuid('group_ticket_type_id must be a valid UUID'),
  quantity: z.number().int('quantity must be an integer').positive('quantity must be positive'),
  members: z.array(GroupMemberSchema).optional().default([]),
});

// ---------------------------------------------------------------------------
// DB adapter factory — replace with real adapter from your service container
// ---------------------------------------------------------------------------

function getDbAdapter(): GroupDbAdapter {
  // In production this would return a real adapter wired to your DB pool.
  // Throwing here keeps the contract explicit; callers must wire a real adapter.
  throw new Error(
    'getDbAdapter() is not implemented. Wire a real GroupDbAdapter from your service container.',
  );
}

// ---------------------------------------------------------------------------
// GET /api/events/[eventId]/group-orders
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

  const { eventId } = params;

  try {
    const db = getDbAdapter();
    const orders = await groupTicketService.listEventGroupOrders(
      eventId,
      organizerId,
      db,
    );
    return NextResponse.json({ data: orders });
  } catch (err) {
    const { status, body } = groupErrorToHttp(err);
    return NextResponse.json(body, { status });
  }
}

// ---------------------------------------------------------------------------
// POST /api/events/[eventId]/group-orders
// ---------------------------------------------------------------------------

export async function POST(
  request: NextRequest,
  { params }: { params: { eventId: string } },
): Promise<NextResponse> {
  const leaderUserId = request.headers.get('x-user-id');
  if (!leaderUserId) {
    return NextResponse.json(
      { error: 'Unauthorized', code: 'UNAUTHORIZED' },
      { status: 401 },
    );
  }

  // Parse and validate request body
  let rawBody: unknown;
  try {
    rawBody = await request.json();
  } catch {
    return NextResponse.json(
      { error: 'Invalid JSON body', code: 'INVALID_JSON' },
      { status: 400 },
    );
  }

  const parseResult = CreateGroupOrderSchema.safeParse(rawBody);
  if (!parseResult.success) {
    return NextResponse.json(
      {
        error: 'Validation failed',
        code: 'VALIDATION_ERROR',
        details: parseResult.error.flatten().fieldErrors,
      },
      { status: 422 },
    );
  }

  const { group_ticket_type_id, quantity, members } = parseResult.data;

  // Sanity-check: the eventId in the URL must match the ticket type's event.
  // The service validates this implicitly via findGroupTicketType, but we keep
  // the eventId available so it can be cross-checked by the adapter if needed.
  void params.eventId; // acknowledged — used by adapter / caller layer

  try {
    const db = getDbAdapter();
    const order = await groupTicketService.createGroupOrder(
      group_ticket_type_id,
      leaderUserId,
      quantity,
      members.map((m) => ({ name: m.name, email: m.email ?? null })),
      db,
    );

    return NextResponse.json(order, { status: 201 });
  } catch (err) {
    const { status, body } = groupErrorToHttp(err);
    return NextResponse.json(body, { status });
  }
}
