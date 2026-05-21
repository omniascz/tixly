/**
 * GET /api/events/[id]/top-picks
 *
 * TM-style Top Picks — recommended seats/tickets per event.
 * Public endpoint (no auth required).
 *
 * Returns top N tickets by pick_score (low price + good availability).
 */
import { NextRequest, NextResponse } from 'next/server';
import { Pool } from 'pg';

let pool: Pool | null = null;
function db(): Pool {
  if (!pool) pool = new Pool({ connectionString: process.env.DATABASE_URL });
  return pool;
}

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) {
    return NextResponse.json({ error: 'INVALID_ID' }, { status: 400 });
  }
  const limit = Math.min(Math.max(Number(req.nextUrl.searchParams.get('limit') ?? '5'), 1), 20);

  const r = await db().query<{
    ticket_type_id: string;
    ticket_type_name: string;
    zone: string | null;
    min_price_halire: number;
    remaining_qty: number;
    availability: string;
    pick_score: number;
  }>(
    `SELECT ticket_type_id, ticket_type_name, zone,
            min_price_halire, remaining_qty, availability, pick_score
       FROM catalog.vw_top_picks
      WHERE event_id = $1
      ORDER BY pick_score DESC
      LIMIT $2`,
    [id, limit],
  );

  return NextResponse.json(
    {
      picks: r.rows.map((row) => ({
        ticketTypeId: row.ticket_type_id,
        name: row.ticket_type_name,
        zone: row.zone,
        priceHalire: row.min_price_halire,
        remaining: row.remaining_qty,
        availability: row.availability, // 'last_few' | 'limited' | 'plenty'
        pickScore: row.pick_score,
      })),
    },
    {
      headers: {
        'Cache-Control': 'public, s-maxage=60, stale-while-revalidate=300',
      },
    },
  );
}
