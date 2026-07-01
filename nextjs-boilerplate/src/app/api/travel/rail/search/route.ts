/**
 * POST /api/travel/rail/search
 *
 * Vyhledá vlakové spoje na akci (destinace = město venue, arrive_by = start akce).
 * Body: { eventId, fromCity }
 * Fail-closed: bez RAIL_API_URL + RAIL_API_KEY vrací 503.
 */
import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { db, runWithServiceContext } from '@/lib/db/rls-pool';
import { railConfig, searchRail } from '@/lib/travel/rail';

const schema = z.object({
  eventId: z.string().uuid(),
  fromCity: z.string().min(1).max(100),
});

export async function POST(req: NextRequest): Promise<Response> {
  const cfg = railConfig();
  if (!cfg) {
    return NextResponse.json(
      { error: 'RAIL_UNAVAILABLE', message: 'Vlakový bundle zatím není napojený (ČD/Regiojet API).' },
      { status: 503 },
    );
  }

  const body: unknown = await req.json().catch(() => ({}));
  const parsed = schema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: 'INVALID_BODY' }, { status: 422 });
  const { eventId, fromCity } = parsed.data;

  return runWithServiceContext(async () => {
    const r = await db().query<{ date_start: string; venue_city: string | null }>(
      `SELECT e.date_start::text, v.city AS venue_city
         FROM catalog.events e LEFT JOIN catalog.venues v ON v.id = e.venue_id
        WHERE e.id = $1 AND e.status = 'published'`,
      [eventId],
    );
    if (r.rows.length === 0) return NextResponse.json({ error: 'EVENT_NOT_FOUND' }, { status: 404 });
    const toCity = r.rows[0].venue_city;
    if (!toCity) return NextResponse.json({ error: 'NO_VENUE_CITY' }, { status: 422 });

    const options = await searchRail(cfg, { fromCity, toCity, arriveByIso: r.rows[0].date_start });
    return NextResponse.json({ options });
  });
}
