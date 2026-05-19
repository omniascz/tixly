/**
 * GET /api/cross-passes/[id] — public cross-pass detail
 */

import { NextRequest, NextResponse } from 'next/server';
import { Pool } from 'pg';

let pool: Pool | null = null;
function db(): Pool {
  if (!pool) pool = new Pool({ connectionString: process.env.DATABASE_URL });
  return pool;
}

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
    price_halire: number;
    capacity: number | null;
    remaining_qty: number | null;
    starts_at: string | null;
    ends_at: string | null;
    active: boolean;
    promoter_name: string | null;
  }>(
    `SELECT b.id, b.name, b.description, b.price_halire, b.capacity, b.remaining_qty,
            b.starts_at, b.ends_at, b.active, p.name AS promoter_name
     FROM catalog.cross_pass_bundles b
     LEFT JOIN platform.promoters p ON p.id = b.promoter_id
     WHERE b.id = $1`,
    [params.id],
  );
  if (r.rows.length === 0 || !r.rows[0].active) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }

  const events = await db().query<{
    event_id: string;
    title: string;
    date_start: string;
    venue_name: string | null;
  }>(
    `SELECT cpe.event_id, e.title, e.date_start, v.name AS venue_name
     FROM catalog.cross_pass_events cpe
     JOIN catalog.events e ON e.id = cpe.event_id
     LEFT JOIN catalog.venues v ON v.id = e.venue_id
     WHERE cpe.bundle_id = $1
     ORDER BY cpe.display_order, e.date_start`,
    [params.id],
  );

  return NextResponse.json({
    bundle: r.rows[0],
    events: events.rows,
  });
}
