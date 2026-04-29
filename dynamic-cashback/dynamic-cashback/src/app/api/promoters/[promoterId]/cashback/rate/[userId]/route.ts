// GET /api/promoters/[promoterId]/cashback/rate/[userId]
// Vrací personalizovanou cashback sazbu uživatele. Přístup: admin nebo self.

import { NextResponse } from 'next/server';
import { getServiceDeps } from '../../../../../../../lib/service-container.js';
import { getPersonalizedRate } from '../../../../../../../services/cashback.service.js';
import { CashbackError } from '../../../../../../../lib/cashback-errors.js';

export async function GET(
  req: Request,
  ctx: { params: { promoterId: string; userId: string } },
): Promise<Response> {
  try {
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
    const eventId = url.searchParams.get('eventId') ?? undefined;

    const deps = await getServiceDeps();
    const rate = await getPersonalizedRate(userId, promoterId, eventId, deps);
    return NextResponse.json(rate);
  } catch (err) {
    if (err instanceof CashbackError) {
      return NextResponse.json(
        { error: err.message, code: err.code },
        { status: err.statusCode },
      );
    }
    return NextResponse.json(
      { error: 'Interní chyba serveru.' },
      { status: 500 },
    );
  }
}
