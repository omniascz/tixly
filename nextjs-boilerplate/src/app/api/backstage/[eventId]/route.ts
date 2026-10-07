import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db/rls-pool';

export async function GET(_req: NextRequest, props: { params: Promise<{ eventId: string }> }): Promise<Response> {
  const params = await props.params;
  const r = await db().query(
    `SELECT * FROM catalog.backstage_moments
      WHERE event_id = $1 AND is_active = true`,
    [params.eventId],
  );

  return NextResponse.json({ moment: r.rows[0] ?? null });
}
