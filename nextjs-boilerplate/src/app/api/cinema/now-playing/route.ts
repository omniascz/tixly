/**
 * GET /api/cinema/now-playing
 * Veřejný endpoint — filmy s alespoň jedním budoucím promítáním.
 * ?city=Praha  (optional filter)
 * ?promoter_id=xxx (optional filter)
 */

import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db/rls-pool';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest): Promise<Response> {
  const city        = req.nextUrl.searchParams.get('city');
  const promoterId  = req.nextUrl.searchParams.get('promoter_id');

  const r = await db().query(
    `SELECT DISTINCT ON (f.id)
       f.id,
       f.title,
       f.original_title,
       f.poster_url,
       f.backdrop_url,
       f.duration_minutes,
       f.age_rating,
       f.genre,
       f.director,
       f.synopsis,
       f.language,
       MIN(e.date_start)       AS next_screening_at,
       COUNT(e.id)::int        AS screening_count,
       ARRAY_AGG(DISTINCT v.city) FILTER (WHERE v.city IS NOT NULL) AS cities,
       ARRAY_AGG(DISTINCT e.screening_format) FILTER (WHERE e.screening_format IS NOT NULL) AS formats
     FROM catalog.films f
     JOIN catalog.events e ON e.film_id = f.id
                           AND e.is_screening = true
                           AND e.status = 'published'
                           AND e.date_start > NOW()
     JOIN catalog.venues v ON v.id = e.venue_id
     WHERE f.status = 'active'
       AND ($1::text IS NULL OR v.city ILIKE $1)
       AND ($2::uuid IS NULL OR e.promoter_id = $2::uuid)
     GROUP BY f.id
     ORDER BY f.id, MIN(e.date_start)
     LIMIT 50`,
    [city ?? null, promoterId ?? null],
  );

  return NextResponse.json({ films: r.rows, count: r.rows.length });
}
