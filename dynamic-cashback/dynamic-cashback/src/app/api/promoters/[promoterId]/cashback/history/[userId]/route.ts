// GET /api/promoters/[promoterId]/cashback/history/[userId]?limit=&offset=

import { NextResponse } from 'next/server';
import { getServiceDeps } from '../../../../../../../lib/service-container.js';
import { listCashbackHistory } from '../../../../../../../services/cashback.service.js';

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

  const url = new URL(req.url);
  const limit = Number(url.searchParams.get('limit') ?? '50');
  const offset = Number(url.searchParams.get('offset') ?? '0');

  const deps = await getServiceDeps();
  const history = await listCashbackHistory(
    userId,
    promoterId,
    { limit, offset },
    deps,
  );
  return NextResponse.json(history);
}
