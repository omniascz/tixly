/**
 * GET /api/public/events/[id]/co2
 *
 * Veřejný CO₂ štítek dopravy na akci + info, jestli je dostupný vlakový bundle.
 * No auth.
 */
import { NextRequest, NextResponse } from 'next/server';
import { db, runWithServiceContext } from '@/lib/db/rls-pool';
import { computeCo2Label } from '@/lib/travel/co2';
import { railConfig } from '@/lib/travel/rail';

export async function GET(
  _req: NextRequest,
  { params }: { params: { id: string } },
): Promise<Response> {
  return runWithServiceContext(async () => {
    const r = await db().query<{ avg_trip_km: number | null; venue_city: string | null }>(
      `SELECT (to_jsonb(e.*) ->> 'avg_trip_km')::int AS avg_trip_km,
              v.city AS venue_city
         FROM catalog.events e
         LEFT JOIN catalog.venues v ON v.id = e.venue_id
        WHERE e.id = $1 AND e.status = 'published'`,
      [params.id],
    );
    if (r.rows.length === 0) return NextResponse.json({ error: 'EVENT_NOT_FOUND' }, { status: 404 });

    const label = computeCo2Label(r.rows[0].avg_trip_km);
    return NextResponse.json(
      {
        co2: label,
        railBundle: { available: railConfig() !== null, toCity: r.rows[0].venue_city },
      },
      { headers: { 'Cache-Control': 'public, s-maxage=300', 'Access-Control-Allow-Origin': '*' } },
    );
  });
}
