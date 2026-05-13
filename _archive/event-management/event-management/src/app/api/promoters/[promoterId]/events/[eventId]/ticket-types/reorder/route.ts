import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { reorderTicketTypes } from '../../../../../../../../services/event.service';
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

const ReorderSchema = z.object({
  orderedIds: z
    .array(z.string().uuid('Každé ID musí být platné UUID.'))
    .min(1, 'Pole orderedIds nesmí být prázdné.'),
});

// ---------------------------------------------------------------------------
// POST /api/promoters/[promoterId]/events/[eventId]/ticket-types/reorder
// ---------------------------------------------------------------------------
export async function POST(
  request: NextRequest,
  { params }: { params: { promoterId: string; eventId: string } },
): Promise<NextResponse> {
  const userId = request.headers.get('x-user-id');
  if (!userId) {
    return NextResponse.json(
      { error: { code: 'UNAUTHORIZED', message: 'Chybí x-user-id header.' } },
      { status: 401 },
    );
  }

  const { promoterId, eventId } = params;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { error: { code: 'INVALID_JSON', message: 'Tělo požadavku není platný JSON.' } },
      { status: 400 },
    );
  }

  const parseResult = ReorderSchema.safeParse(body);
  if (!parseResult.success) {
    return NextResponse.json(
      { error: { code: 'VALIDATION_ERROR', message: parseResult.error.errors[0]?.message ?? 'Neplatná data.' } },
      { status: 400 },
    );
  }

  try {
    const ticketTypes = await reorderTicketTypes(
      eventId,
      promoterId,
      parseResult.data.orderedIds,
      _getDeps(),
    );
    return NextResponse.json(ticketTypes, { status: 200 });
  } catch (err) {
    if (err instanceof EventManagementError) {
      return NextResponse.json(err.toHttpError(), { status: err.statusCode });
    }
    throw err;
  }
}
