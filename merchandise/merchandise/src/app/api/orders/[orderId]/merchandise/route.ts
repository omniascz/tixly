import { NextRequest, NextResponse } from 'next/server';
import { reserveMerchandise } from '../../../../../services/merchandise.service';
import { isMerchandiseError } from '../../../../../lib/merchandise-errors';
import { reserveMerchandiseBodySchema } from '../../../../../lib/zod-schemas';
import type { ServiceDeps } from '../../../../../lib/service-container';

export function buildDeps(): ServiceDeps {
  throw new Error('Production deps not configured — use dependency injection');
}

export async function POST(
  request: NextRequest,
  { params }: { params: { orderId: string } },
  deps?: ServiceDeps,
): Promise<NextResponse> {
  try {
    const { orderId } = params;

    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
    }

    const parsed = reserveMerchandiseBodySchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: 'Validation failed', details: parsed.error.flatten() },
        { status: 400 },
      );
    }

    const { items, idempotencyKey } = parsed.data;

    const serviceDeps = deps ?? buildDeps();
    const createdItems = await reserveMerchandise(orderId, items, idempotencyKey, serviceDeps);

    return NextResponse.json(createdItems, { status: 201 });
  } catch (err) {
    if (isMerchandiseError(err)) {
      return NextResponse.json(err.toHttpError(), { status: err.statusCode });
    }
    console.error('[POST /api/orders/[orderId]/merchandise]', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
