import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db/rls-pool';

export async function GET(
  _req: NextRequest,
  { params }: { params: { eventId: string } },
): Promise<Response> {
  const r = await db().query(
    `SELECT * FROM catalog.backstage_moments
      WHERE event_id = $1 AND is_active = true`,
    [params.eventId],
  );

  return NextResponse.json({ moment: r.rows[0] ?? null });
}
