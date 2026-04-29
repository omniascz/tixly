import { NextRequest, NextResponse } from 'next/server';
import { listTicketsForOrder } from '../../../../../../services/cs.service';
import { isCsError, CsError } from '../../../../../../lib/cs-errors';

export function makeListTicketsHandler(deps: Parameters<typeof listTicketsForOrder>[1]) {
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
      const tickets = await listTicketsForOrder(params.orderId, deps);
      return NextResponse.json(tickets);
    } catch (err) {
      if (isCsError(err)) {
        return NextResponse.json(err.toHttpError(), { status: err.statusCode });
      }
      throw err;
    }
  };
}
