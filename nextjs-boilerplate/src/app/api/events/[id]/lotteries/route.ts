/**
 * GET /api/events/[id]/lotteries
 * Public — list aktivních losování pro event (status='open' a NOW < closes_at).
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
    description: string | null;
    closes_at: string;
    draw_at: string;
    max_per_entry: number;
    payment_deadline_hours: number;
  }>(
    `SELECT id, name, description, closes_at, draw_at, max_per_entry, payment_deadline_hours
     FROM catalog.event_lotteries
     WHERE event_id = $1 AND status = 'open'
       AND opens_at <= NOW() AND closes_at > NOW()
     ORDER BY closes_at ASC`,
    [params.id],
  );
  return NextResponse.json({ lotteries: r.rows });
}
