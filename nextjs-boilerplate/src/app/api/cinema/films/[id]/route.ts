/**
 * GET /api/cinema/films/[id]
 * Veřejný detail filmu + seznam promítání (screenings).
 * ?date=2026-07-01  (optional: filter screenings by date)
 */

import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db/rls-pool';

export const dynamic = 'force-dynamic';

export async function GET(
  req: NextRequest,
  { params }: { params: { id: string } },
): Promise<Response> {
  const dateFilter = req.nextUrl.searchParams.get('date'); // YYYY-MM-DD

  const [filmR, screeningsR] = await Promise.all([
    db().query(
      `SELECT id, title, original_title, synopsis, poster_url, backdrop_url,
              trailer_url, duration_minutes, age_rating, genre, director,
              cast_main, language, original_language, country, release_year
       FROM catalog.films WHERE id=$1 AND status='active'`,
      [params.id],
    ),
    db().query(
      `SELECT
         e.id            AS event_id,
         e.date_start,
         e.screening_format,
         e.screening_language,
         e.slug,
         cs.name         AS screen_name,
         cs.screen_type,
         cs.has_3d,
         cs.is_accessible,
         v.id            AS venue_id,
         v.name          AS venue_name,
         v.city          AS venue_city,
         v.address       AS venue_address,
         (SELECT MIN(tt.base_price) FROM catalog.ticket_types tt
          WHERE tt.event_id = e.id AND tt.remaining_qty > 0)::int  AS price_from,
         (SELECT SUM(tt.remaining_qty) FROM catalog.ticket_types tt
          WHERE tt.event_id = e.id)::int  AS remaining_qty
       FROM catalog.events e
       LEFT JOIN catalog.cinema_screens cs ON cs.id = e.cinema_screen_id
       LEFT JOIN catalog.venues          v  ON v.id  = e.venue_id
       WHERE e.film_id = $1
         AND e.is_screening = true
         AND e.status = 'published'
         AND e.date_start > NOW()
         AND ($2::date IS NULL OR e.date_start::date = $2::date)
       ORDER BY e.date_start ASC
       LIMIT 100`,
      [params.id, dateFilter ?? null],
    ),
  ]);

  if (filmR.rows.length === 0) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }

  const byDate: Record<string, typeof screeningsR.rows> = {};
  for (const s of screeningsR.rows) {
    const day = (s.date_start as string).slice(0, 10);
    (byDate[day] ??= []).push(s);
  }

  return NextResponse.json({
    film: filmR.rows[0],
    screenings: screeningsR.rows,
    screenings_by_date: byDate,
    total_screenings: screeningsR.rows.length,
  });
}
