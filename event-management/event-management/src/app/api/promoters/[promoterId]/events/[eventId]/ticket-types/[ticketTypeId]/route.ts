import { NextRequest, NextResponse } from 'next/server';
import { UpdateTicketTypeSchema } from '../../../../../../../../lib/zod-schemas';
import { updateTicketType, deleteTicketType } from '../../../../../../../../services/event.service';
import { EventManagementError } from '../../../../../../../../lib/event-errors';
import type { ServiceDeps } from '../../../../../../../../lib/service-container';

// ---------------------------------------------------------------------------
// Deps factory — přepsatelná v testech
// ---------------------------------------------------------------------------
export let _getDeps: () => ServiceDeps = () => {
  throw new Error('DB adapter not configured — inject via _getDeps');
};

export function _setDeps(factory: () => ServiceDeps): void {
  _getDeps = factory;
}

// ---------------------------------------------------------------------------
// PATCH /api/promoters/[promoterId]/events/[eventId]/ticket-types/[ticketTypeId]
// ---------------------------------------------------------------------------
export async function PATCH(
  request: NextRequest,
  { params }: { params: { promoterId: string; eventId: string; ticketTypeId: string } },
): Promise<NextResponse> {
  const userId = request.headers.get('x-user-id');
  if (!userId) {
    return NextResponse.json(
      { error: { code: 'UNAUTHORIZED', message: 'Chybí x-user-id header.' } },
      { status: 401 },
    );
  }

  const { promoterId, ticketTypeId } = params;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { error: { code: 'INVALID_JSON', message: 'Tělo požadavku není platný JSON.' } },
      { status: 400 },
    );
  }

  const parseResult = UpdateTicketTypeSchema.safeParse(body);
  if (!parseResult.success) {
    return NextResponse.json(
      { error: { code: 'VALIDATION_ERROR', message: parseResult.error.errors[0]?.message ?? 'Neplatná data.' } },
      { status: 400 },
    );
  }

  try {
    const ticketType = await updateTicketType(ticketTypeId, promoterId, parseResult.data, _getDeps());
    return NextResponse.json(ticketType, { status: 200 });
  } catch (err) {
    if (err instanceof EventManagementError) {
      return NextResponse.json(err.toHttpError(), { status: err.statusCode });
    }
    throw err;
  }
}

// ---------------------------------------------------------------------------
// DELETE /api/promoters/[promoterId]/events/[eventId]/ticket-types/[ticketTypeId]
// ---------------------------------------------------------------------------
export async function DELETE(
  request: NextRequest,
  { params }: { params: { promoterId: string; eventId: string; ticketTypeId: string } },
): Promise<NextResponse> {
  const userId = request.headers.get('x-user-id');
  if (!userId) {
    return NextResponse.json(
      { error: { code: 'UNAUTHORIZED', message: 'Chybí x-user-id header.' } },
      { status: 401 },
    );
  }

  const { promoterId, ticketTypeId } = params;

  try {
    await deleteTicketType(ticketTypeId, promoterId, _getDeps());
    return new NextResponse(null, { status: 204 });
  } catch (err) {
    if (err instanceof EventManagementError) {
      return NextResponse.json(err.toHttpError(), { status: err.statusCode });
    }
    throw err;
  }
}
