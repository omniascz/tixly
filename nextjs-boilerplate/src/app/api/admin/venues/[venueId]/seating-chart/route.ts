/**
 * GET  /api/admin/venues/[venueId]/seating-chart — promoter-readable layout (event setup).
 * POST — DEPRECATED. Sály jsou platform-level resource; pouze master admin může editovat.
 *        Vrací 403 a odkaz na /platform/venues/[id]/seating-chart.
 */

import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db/rls-pool';
import { runAsPromoter } from '@/lib/admin-auth';


export async function GET(
  req: NextRequest,
  { params }: { params: { venueId: string } },
): Promise<Response> {
  return runAsPromoter(req, async (_promoter) => {
  const r = await db().query<{
    id: string;
    name: string;
    layout: unknown;
    total_seats: number;
  }>(
    `SELECT id, name, layout, total_seats FROM catalog.venue_seating_charts
     WHERE venue_id = $1 AND active = true
     ORDER BY created_at DESC LIMIT 1`,
    [params.venueId],
  );
  if (r.rows.length === 0) return NextResponse.json({ chart: null });
  return NextResponse.json({ chart: r.rows[0] });

  });
}

export async function POST(): Promise<Response> {
  return NextResponse.json(
    {
      error: 'Forbidden',
      reason: 'Sály edituje pouze master admin. Promotéři vybírají z katalogu.',
      redirect: '/platform/venues',
    },
    { status: 403 },
  );
}
