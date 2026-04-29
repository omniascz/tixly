import { NextRequest, NextResponse } from 'next/server';
import { getCustomer } from '../../../../../services/cs.service';
import { isCsError, CsError } from '../../../../../lib/cs-errors';

export function makeGetCustomerHandler(deps: Parameters<typeof getCustomer>[1]) {
  return async function GET(
    req: NextRequest,
    { params }: { params: { userId: string } },
  ) {
    const agentId = req.headers.get('x-cs-agent-id');
    if (!agentId) {
      const err = new CsError('UNAUTHORIZED');
      return NextResponse.json(err.toHttpError(), { status: err.statusCode });
    }

    try {
      const customer = await getCustomer(params.userId, deps);
      return NextResponse.json(customer);
    } catch (err) {
      if (isCsError(err)) {
        return NextResponse.json(err.toHttpError(), { status: err.statusCode });
      }
      throw err;
    }
  };
}
