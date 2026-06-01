/**
 * GET /api/platform/venues/[id]/seating-chart/diff?from=<chartId>&to=<chartId>
 *
 * Spočítá diff mezi dvěma verzemi: added/removed/moved seats, sektor-level summary.
 */

import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db/rls-pool';
import { runAsPlatformAdmin } from '@/lib/platform-auth';
import { diffLayouts } from '@/lib/seating/diff';


interface ChartLayout {
  viewBox: string;
  sectors: { name: string; color?: string; rows: { label: string; seats: { num: string; x: number; y: number; accessibility?: boolean }[] }[] }[];
}

export async function GET(
  req: NextRequest,
  { params }: { params: { id: string } },
): Promise<Response> {
  return runAsPlatformAdmin(req, async (_admin) => {
  const fromId = req.nextUrl.searchParams.get('from');
  const toId = req.nextUrl.searchParams.get('to');
  if (!fromId || !toId) {
    return NextResponse.json({ error: 'Missing ?from=&to=' }, { status: 422 });
  }

  const r = await db().query<{ id: string; layout: ChartLayout; created_at: string; name: string }>(
    `SELECT id, layout, created_at, name FROM catalog.venue_seating_charts
      WHERE venue_id = $1 AND id = ANY($2::uuid[])`,
    [params.id, [fromId, toId]],
  );
  if (r.rows.length !== 2) {
    return NextResponse.json({ error: 'One or both versions not found' }, { status: 404 });
  }
  const fromRow = r.rows.find((x) => x.id === fromId);
  const toRow = r.rows.find((x) => x.id === toId);
  if (!fromRow || !toRow) {
    return NextResponse.json({ error: 'Version mismatch' }, { status: 404 });
  }

  const result = diffLayouts(fromRow.layout, toRow.layout);
  return NextResponse.json({
    from: { id: fromRow.id, name: fromRow.name, createdAt: fromRow.created_at },
    to: { id: toRow.id, name: toRow.name, createdAt: toRow.created_at },
    diff: result,
  });

  });
}
