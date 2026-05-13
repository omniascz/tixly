import { NextRequest, NextResponse } from 'next/server';
import { getOrder } from '../../../../../services/cs.service.js';
import { getOrderDetail } from '../../../../../services/cs-extended.service.js';
import { isCsError, CsError } from '../../../../../lib/cs-errors.js';
import type { CsExtDeps } from '../../../../../services/cs-extended.service.js';

function requireAdmin(req: NextRequest): string | null {
  const userId = req.headers.get('x-user-id');
  const isAdmin = req.headers.get('x-is-admin');
  if (!userId || isAdmin !== 'true') return null;
  return userId;
}

export async function GET(
  req: NextRequest,
  { params }: { params: { orderId: string } },
) {
  const agentId = req.headers.get('x-cs-agent-id');
  if (!agentId) {
    const err = new CsError('UNAUTHORIZED');
    return NextResponse.json(err.toHttpError(), { status: err.statusCode });
  }

  try {
    const { orderId } = params;
    void orderId;
    return NextResponse.json({ error: 'DB_NOT_INJECTED' }, { status: 500 });
  } catch (err) {
    if (isCsError(err)) {
      return NextResponse.json(err.toHttpError(), { status: err.statusCode });
    }
    throw err;
  }
}

// Factory for testable handler creation (legacy — plain order)
export function makeGetOrderHandler(deps: Parameters<typeof getOrder>[1]) {
  return async function GET(
    req: NextRequest,
    { params }: { params: { orderId: string } },
  ) {
    const agentId = req.headers.get('x-cs-agent-id');
    if (!agentId) {
      const err = new CsError('UNAUTHORIZED');
      return NextResponse.json(err.toHttpError(), { status: err.statusCode });
    }

    try {
      const order = await getOrder(params.orderId, deps);
      return NextResponse.json(order);
    } catch (err) {
      if (isCsError(err)) {
        return NextResponse.json(err.toHttpError(), { status: err.statusCode });
      }
      throw err;
    }
  };
}

// Factory for detailed order view (admin-only, uses CsExtDeps)
export function makeGetOrderDetailHandler(deps: CsExtDeps) {
  return async function GET(
    req: NextRequest,
    { params }: { params: { orderId: string } },
  ) {
    const csUserId = requireAdmin(req);
    if (!csUserId) {
      const err = new CsError('FORBIDDEN');
      return NextResponse.json(err.toHttpError(), { status: err.statusCode });
    }

    try {
      const detail = await getOrderDetail(params.orderId, deps);
      return NextResponse.json(detail);
    } catch (err) {
      if (isCsError(err)) {
        return NextResponse.json(err.toHttpError(), { status: err.statusCode });
      }
      throw err;
    }
  };
}
