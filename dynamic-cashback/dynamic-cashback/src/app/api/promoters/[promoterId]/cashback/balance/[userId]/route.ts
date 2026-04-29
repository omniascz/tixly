// GET /api/promoters/[promoterId]/cashback/balance/[userId]

import { NextResponse } from 'next/server';
import { getServiceDeps } from '../../../../../../../lib/service-container.js';
import { getUserCashbackBalance } from '../../../../../../../services/cashback.service.js';

export async function GET(
  req: Request,
  ctx: { params: { promoterId: string; userId: string } },
): Promise<Response> {
  const { promoterId, userId } = ctx.params;
  const requester = req.headers.get('x-user-id');
  const role = req.headers.get('x-user-role');
  if (role !== 'admin' && requester !== userId) {
    return NextResponse.json(
      { error: 'Nedostatečná oprávnění.' },
      { status: 403 },
    );
  }

  const deps = await getServiceDeps();
  const balance = await getUserCashbackBalance(userId, promoterId, deps);
  return NextResponse.json(balance);
}
