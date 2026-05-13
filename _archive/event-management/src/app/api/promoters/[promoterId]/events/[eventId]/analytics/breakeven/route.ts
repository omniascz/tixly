import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { calculateBreakeven } from '../../../../../../../../services/breakeven.service.js';
import { EventManagementError } from '../../../../../../../../lib/event-errors.js';
import { getServiceDeps } from '../../../../../../../../lib/service-container.js';

const BreakevenInputSchema = z.object({
  fixedCostsHalire: z.number().int().min(0),
  variableCostPerTicketHalire: z.number().int().min(0),
});

export async function POST(
  request: NextRequest,
  { params }: { params: { promoterId: string; eventId: string } },
): Promise<NextResponse> {
  const promoterId = request.headers.get('x-promoter-id') ?? params.promoterId;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'INVALID_JSON' }, { status: 400 });
  }

  const parsed = BreakevenInputSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: 'VALIDATION_ERROR', issues: parsed.error.issues }, { status: 400 });
  }

  try {
    const result = await calculateBreakeven(params.eventId, promoterId, parsed.data, getServiceDeps());
    return NextResponse.json(result);
  } catch (err) {
    if (err instanceof EventManagementError) {
      return NextResponse.json(err.toHttpError(), { status: err.statusCode });
    }
    return NextResponse.json({ error: 'INTERNAL_ERROR' }, { status: 500 });
  }
}
