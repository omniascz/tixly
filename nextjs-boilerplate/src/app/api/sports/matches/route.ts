/**
 * GET /api/sports/matches
 * Veřejný endpoint — nadcházející zápasy.
 * ?sport=football   — filtr sport_type
 * ?city=Praha       — filtr venue city
 * ?team_id=uuid     — zápasy konkrétního týmu
 * ?promoter_id=uuid — filtr promotéra
 * ?days=30          — kolik dní dopředu (default 30, max 365)
 */

import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db/rls-pool';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest): Promise<Response> {
  const sp = req.nextUrl.searchParams;
  const sport      = sp.get('sport');
  const city       = sp.get('city');
  const teamId     = sp.get('team_id');
  const promoterId = sp.get('promoter_id');
  const days       = Math.min(Math.max(Number(sp.get('days') ?? '30'), 1), 365);

  const r = await db().query(
    `SELECT
       e.id            AS event_id,
       e.title,
       e.slug,
       e.date_start,
       e.cover_image_url,
       e.sport_type,
       e.competition,
       e.match_day,
       e.is_home_match,
       ht.id           AS home_team_id,
       ht.name         AS home_team_name,
       ht.short_name   AS home_team_short,
       ht.logo_url     AS home_team_logo,
       ht.primary_color AS home_color,
       at.id           AS away_team_id,
       at.name         AS away_team_name,
       at.short_name   AS away_team_short,
       at.logo_url     AS away_team_logo,
       at.primary_color AS away_color,
       v.name          AS venue_name,
       v.city          AS venue_city,
       v.address       AS venue_address,
       (SELECT MIN(tt.price) FROM catalog.ticket_types tt
        WHERE tt.event_id = e.id AND tt.status = 'active')::int  AS price_from,
       (SELECT SUM(tt.remaining_qty) FROM catalog.ticket_types tt
        WHERE tt.event_id = e.id AND tt.status = 'active')::int  AS remaining_qty
     FROM catalog.events e
     LEFT JOIN catalog.sport_teams ht ON ht.id = e.home_team_id
     LEFT JOIN catalog.sport_teams at ON at.id = e.away_team_id
     LEFT JOIN catalog.venues       v  ON v.id  = e.venue_id
     WHERE e.is_match = true
       AND e.status = 'published'
       AND e.date_start > NOW()
       AND e.date_start < NOW() + ($1 || ' days')::interval
       AND ($2::text IS NULL OR e.sport_type = $2)
       AND ($3::text IS NULL OR v.city ILIKE $3)
       AND ($4::uuid IS NULL OR e.home_team_id = $4::uuid OR e.away_team_id = $4::uuid)
       AND ($5::uuid IS NULL OR e.promoter_id = $5::uuid)
     ORDER BY e.date_start ASC
     LIMIT 100`,
    [days, sport ?? null, city ?? null, teamId ?? null, promoterId ?? null],
  );

  return NextResponse.json({ matches: r.rows, count: r.rows.length });
}
