import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { getProductsForEvent } from '../../../../../services/merchandise.service';
import { isMerchandiseError } from '../../../../../lib/merchandise-errors';
import { eventMerchandiseQuerySchema } from '../../../../../lib/zod-schemas';
import type { ServiceDeps } from '../../../../../lib/service-container';

// Production implementations would be injected; exported for testability
export function buildDeps(): ServiceDeps {
  // In production these come from a DI container / environment
  throw new Error('Production deps not configured — use dependency injection');
}

export async function GET(
  request: NextRequest,
  { params }: { params: { eventId: string } },
  deps?: ServiceDeps,
): Promise<NextResponse> {
  try {
    const { eventId } = params;

    const searchParams = Object.fromEntries(request.nextUrl.searchParams.entries());
    const parsed = eventMerchandiseQuerySchema.safeParse(searchParams);
    if (!parsed.success) {
      return NextResponse.json(
        { error: 'Invalid query parameters', details: parsed.error.flatten() },
        { status: 400 },
      );
    }

    const serviceDeps = deps ?? buildDeps();
    const products = await getProductsForEvent(eventId, parsed.data.fulfillment, serviceDeps);

    return NextResponse.json(products, { status: 200 });
  } catch (err) {
    if (isMerchandiseError(err)) {
      return NextResponse.json(err.toHttpError(), { status: err.statusCode });
    }
    console.error('[GET /api/events/[eventId]/merchandise]', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
