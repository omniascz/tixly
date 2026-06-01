/**
 * GET /api/events/[id]/payment-plans
 *
 * Public — buyer si na checkout vybere plán.
 * Vrací aktivní plány pro danou akci.
 */

import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db/rls-pool';


export async function GET(
  _req: NextRequest,
  { params }: { params: { id: string } },
): Promise<Response> {
  if (!/^[0-9a-f-]{36}$/i.test(params.id)) {
    return NextResponse.json({ error: 'Invalid id' }, { status: 422 });
  }
  const r = await db().query<{
    id: string;
    name: string;
    deposit_pct: number;
    installments_count: number;
    interval_days: number;
  }>(
    `SELECT id, name, deposit_pct, installments_count, interval_days
     FROM catalog.payment_plans
     WHERE event_id = $1 AND active = true
     ORDER BY deposit_pct DESC, installments_count ASC`,
    [params.id],
  );
  return NextResponse.json({ plans: r.rows });
}
