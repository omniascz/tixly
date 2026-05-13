import { NextRequest, NextResponse } from 'next/server';
import {
  updateProduct,
  archiveProduct,
} from '../../../../../../../services/merchandise.service';
import { isMerchandiseError } from '../../../../../../../lib/merchandise-errors';
import { updateProductBodySchema } from '../../../../../../../lib/zod-schemas';
import type { ServiceDeps } from '../../../../../../../lib/service-container';

export function buildDeps(): ServiceDeps {
  throw new Error('Production deps not configured — use dependency injection');
}

function getOrganizerId(request: NextRequest): string | null {
  return request.headers.get('x-organizer-id');
}

export async function PUT(
  request: NextRequest,
  { params }: { params: { eventId: string; productId: string } },
  deps?: ServiceDeps,
): Promise<NextResponse> {
  try {
    const { productId } = params;

    const organizerId = getOrganizerId(request);
    if (!organizerId) {
      return NextResponse.json({ error: 'Missing x-organizer-id header' }, { status: 401 });
    }

    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
    }

    const parsed = updateProductBodySchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: 'Validation failed', details: parsed.error.flatten() },
        { status: 400 },
      );
    }

    const serviceDeps = deps ?? buildDeps();
    const product = await updateProduct(productId, organizerId, parsed.data, serviceDeps);

    return NextResponse.json(product, { status: 200 });
  } catch (err) {
    if (isMerchandiseError(err)) {
      return NextResponse.json(err.toHttpError(), { status: err.statusCode });
    }
    console.error('[PUT /api/organizer/events/[eventId]/merchandise/[productId]]', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: { eventId: string; productId: string } },
  deps?: ServiceDeps,
): Promise<NextResponse> {
  try {
    const { productId } = params;

    const organizerId = getOrganizerId(request);
    if (!organizerId) {
      return NextResponse.json({ error: 'Missing x-organizer-id header' }, { status: 401 });
    }

    const serviceDeps = deps ?? buildDeps();
    await archiveProduct(productId, organizerId, serviceDeps);

    return new NextResponse(null, { status: 204 });
  } catch (err) {
    if (isMerchandiseError(err)) {
      return NextResponse.json(err.toHttpError(), { status: err.statusCode });
    }
    console.error('[DELETE /api/organizer/events/[eventId]/merchandise/[productId]]', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
