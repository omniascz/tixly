/**
 * GET /api/platform/venues/[id]/seating-chart/summary
 *
 * Lightweight: vrátí pouze názvy sektorů + počty řad/seats. Pro velké stadiony (Camp Nou
 * 99 000 seats) je plný layout několik MB — summary je < 5 kB.
 *
 * Volá se z venue list/dropdown a event editor pro zobrazení "5 sektorů, 99 354 sedadel"
 * bez nutnosti tahat celý layout.
 */

import { NextRequest, NextResponse } from 'next/server';
import { Pool } from 'pg';
import { requirePlatformAdmin } from '@/lib/platform-auth';

let pool: Pool | null = null;
function db(): Pool {
  if (!pool) pool = new Pool({ connectionString: process.env.DATABASE_URL });
  return pool;
}

interface ChartLayout {
  viewBox: string;
  sectors: { name: string; color?: string; rows: { label: string; seats: { num: string }[] }[] }[];
}

export async function GET(
  req: NextRequest,
  { params }: { params: { id: string } },
): Promise<Response> {
  const admin = await requirePlatformAdmin(req);
  if (!admin) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  const r = await db().query<{ id: string; name: string; layout: ChartLayout; total_seats: number; created_at: string }>(
    `SELECT id, name, layout, total_seats, created_at FROM catalog.venue_seating_charts
      WHERE venue_id = $1 AND active = true
      ORDER BY created_at DESC LIMIT 1`,
    [params.id],
  );
  if (!r.rows.length) {
    return NextResponse.json({ summary: null });
  }
  const c = r.rows[0];
  const sectors = c.layout.sectors.map((s) => {
    let seats = 0;
    for (const row of s.rows) seats += row.seats.length;
    return { name: s.name, color: s.color, rowCount: s.rows.length, seatCount: seats };
  });
  const headers = new Headers({ 'Cache-Control': 'private, max-age=60' });
  return NextResponse.json(
    {
      summary: {
        chartId: c.id, name: c.name,
        totalSeats: c.total_seats,
        sectorCount: sectors.length,
        sectors, viewBox: c.layout.viewBox,
        createdAt: c.created_at,
      },
    },
    { headers },
  );
}
