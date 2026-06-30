/**
 * GET /api/sports/teams/[id]
 * Veřejný profil týmu + nadcházející zápasy.
 */

import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db/rls-pool';

export const dynamic = 'force-dynamic';

export async function GET(
  _req: NextRequest,
  { params }: { params: { id: string } },
): Promise<Response> {
  const [teamR, matchesR] = await Promise.all([
    db().query(
      `SELECT id, name, short_name, code, sport_type, logo_url,
              primary_color, secondary_color, city, country,
              league_name, founded_year, website_url, stadium_name
       FROM catalog.sport_teams WHERE id=$1 AND status='active'`,
      [params.id],
    ),
    db().query(
      `SELECT
         e.id AS event_id, e.title, e.slug, e.date_start,
         e.competition, e.match_day, e.is_home_match,
         ht.id AS home_team_id, ht.name AS home_team_name, ht.short_name AS home_short,
         ht.logo_url AS home_logo, ht.primary_color AS home_color,
         at.id AS away_team_id, at.name AS away_team_name, at.short_name AS away_short,
         at.logo_url AS away_logo, at.primary_color AS away_color,
         v.name AS venue_name, v.city AS venue_city,
         (SELECT MIN(tt.base_price) FROM catalog.ticket_types tt
          WHERE tt.event_id = e.id AND tt.remaining_qty > 0)::int AS price_from,
         (SELECT SUM(tt.remaining_qty) FROM catalog.ticket_types tt
          WHERE tt.event_id = e.id)::int AS remaining_qty
       FROM catalog.events e
       LEFT JOIN catalog.sport_teams ht ON ht.id = e.home_team_id
       LEFT JOIN catalog.sport_teams at ON at.id = e.away_team_id
       LEFT JOIN catalog.venues       v  ON v.id  = e.venue_id
       WHERE (e.home_team_id = $1 OR e.away_team_id = $1)
         AND e.is_match = true
         AND e.status = 'published'
         AND e.date_start > NOW()
       ORDER BY e.date_start ASC
       LIMIT 50`,
      [params.id],
    ),
  ]);

  if (teamR.rows.length === 0) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }

  return NextResponse.json({ team: teamR.rows[0], matches: matchesR.rows });
}
