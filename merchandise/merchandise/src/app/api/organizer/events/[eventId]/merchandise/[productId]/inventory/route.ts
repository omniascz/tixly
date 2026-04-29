import { NextRequest, NextResponse } from 'next/server';
import { getInventory } from '../../../../../../../../services/merchandise.service';
import { isMerchandiseError } from '../../../../../../../../lib/merchandise-errors';
import type { ServiceDeps } from '../../../../../../../../lib/service-container';

export function buildDeps(): ServiceDeps {
  throw new Error('Production deps not configured — use dependency injection');
}

export async function GET(
  request: NextRequest,
  { params }: { params: { eventId: string; productId: string } },
  deps?: ServiceDeps,
): Promise<NextResponse> {
  try {
    const { productId } = params;

    const organizerId = request.headers.get('x-organizer-id');
    if (!organizerId) {
      return NextResponse.json({ error: 'Missing x-organizer-id header' }, { status: 401 });
    }

    const serviceDeps = deps ?? buildDeps();
    const inventory = await getInventory(productId, organizerId, serviceDeps);

    return NextResponse.json(inventory, { status: 200 });
  } catch (err) {
    if (isMerchandiseError(err)) {
      return NextResponse.json(err.toHttpError(), { status: err.statusCode });
    }
    console.error('[GET inventory]', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
