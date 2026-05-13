import { NextRequest, NextResponse } from 'next/server';
import {
  getProductsForOrganizer,
  createProduct,
} from '../../../../../../services/merchandise.service';
import { isMerchandiseError } from '../../../../../../lib/merchandise-errors';
import { createProductBodySchema } from '../../../../../../lib/zod-schemas';
import type { ServiceDeps } from '../../../../../../lib/service-container';

export function buildDeps(): ServiceDeps {
  throw new Error('Production deps not configured — use dependency injection');
}

function getOrganizerId(request: NextRequest): string | null {
  return request.headers.get('x-organizer-id');
}

export async function GET(
  request: NextRequest,
  { params }: { params: { eventId: string } },
  deps?: ServiceDeps,
): Promise<NextResponse> {
  try {
    const { eventId } = params;

    const organizerId = getOrganizerId(request);
    if (!organizerId) {
      return NextResponse.json({ error: 'Missing x-organizer-id header' }, { status: 401 });
    }

    const serviceDeps = deps ?? buildDeps();
    const products = await getProductsForOrganizer(eventId, organizerId, serviceDeps);

    return NextResponse.json(products, { status: 200 });
  } catch (err) {
    if (isMerchandiseError(err)) {
      return NextResponse.json(err.toHttpError(), { status: err.statusCode });
    }
    console.error('[GET /api/organizer/events/[eventId]/merchandise]', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

export async function POST(
  request: NextRequest,
  { params }: { params: { eventId: string } },
  deps?: ServiceDeps,
): Promise<NextResponse> {
  try {
    const { eventId } = params;

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

    const parsed = createProductBodySchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: 'Validation failed', details: parsed.error.flatten() },
        { status: 400 },
      );
    }

    const serviceDeps = deps ?? buildDeps();
    const product = await createProduct(eventId, organizerId, parsed.data, serviceDeps);

    return NextResponse.json(product, { status: 201 });
  } catch (err) {
    if (isMerchandiseError(err)) {
      return NextResponse.json(err.toHttpError(), { status: err.statusCode });
    }
    console.error('[POST /api/organizer/events/[eventId]/merchandise]', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
