import { NextRequest, NextResponse } from 'next/server';
import { cancelMerchandiseItem } from '../../../../../../services/merchandise.service';
import { isMerchandiseError } from '../../../../../../lib/merchandise-errors';
import type { ServiceDeps } from '../../../../../../lib/service-container';

export function buildDeps(): ServiceDeps {
  throw new Error('Production deps not configured — use dependency injection');
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: { orderId: string; orderItemId: string } },
  deps?: ServiceDeps,
): Promise<NextResponse> {
  try {
    const { orderId, orderItemId } = params;

    // Anti-enumeration: require user identity header
    const userId = request.headers.get('x-user-id');
    if (!userId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const serviceDeps = deps ?? buildDeps();
    await cancelMerchandiseItem(orderId, orderItemId, userId, serviceDeps);

    return new NextResponse(null, { status: 204 });
  } catch (err) {
    if (isMerchandiseError(err)) {
      return NextResponse.json(err.toHttpError(), { status: err.statusCode });
    }
    console.error('[DELETE /api/orders/[orderId]/merchandise/[orderItemId]]', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
