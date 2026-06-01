/**
 * GET /api/public/events/[id]/buyer-cap-check
 *
 * Veřejný endpoint pro frontend checkout — vrátí jestli logged-in buyer
 * (z x-user-id) může koupit X dalších lístků.
 *
 * Query: ?qty=2  (kolik chce koupit)
 */
import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db/rls-pool';
import { runAsUser } from '@/lib/auth';
import { checkBuyerCap } from '@/lib/hot-events/enforcement';

export async function GET(
  req: NextRequest,
  { params }: { params: { id: string } },
): Promise<Response> {
  return runAsUser(req, async (userId) => {
    const qty = Number(new URL(req.url).searchParams.get('qty') ?? '1');
    if (!Number.isFinite(qty) || qty < 1 || qty > 50) {
      return NextResponse.json({ error: 'INVALID_QTY' }, { status: 422 });
    }

    const userRes = await db().query<{ phone: string | null }>(
      `SELECT phone FROM identity.users WHERE id = $1`,
      [userId],
    );

    const result = await checkBuyerCap({
      eventId: params.id,
      userId,
      phoneE164: userRes.rows[0]?.phone ?? null,
      requestedTickets: qty,
    });

    return NextResponse.json(result);
  });
}
