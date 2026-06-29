/**
 * GET    /api/admin/sport-teams/[id]  — detail + nadcházející zápasy
 * PATCH  /api/admin/sport-teams/[id]  — editovat tým
 * DELETE /api/admin/sport-teams/[id]  — archivovat
 */

import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db/rls-pool';
import { runAsPromoter } from '@/lib/admin-auth';

export const dynamic = 'force-dynamic';

export async function GET(
  req: NextRequest,
  { params }: { params: { id: string } },
): Promise<Response> {
  return runAsPromoter(req, async (ctx) => {
    const [teamR, matchesR] = await Promise.all([
      db().query(
        `SELECT * FROM catalog.sport_teams
         WHERE id = $1 AND (promoter_id = $2 OR promoter_id IS NULL)`,
        [params.id, ctx.promoterId],
      ),
      db().query(
        `SELECT
           e.id, e.title, e.date_start, e.status,
           e.competition, e.match_day, e.is_home_match,
           ht.name AS home_team_name, ht.logo_url AS home_team_logo,
           at.name AS away_team_name, at.logo_url AS away_team_logo,
           v.name AS venue_name, v.city AS venue_city,
           (SELECT COUNT(*) FROM tickets.tickets t
             JOIN orders.orders o ON o.id = t.order_id
             WHERE o.event_id = e.id AND o.status = 'paid')::int AS tickets_sold
         FROM catalog.events e
         LEFT JOIN catalog.sport_teams ht ON ht.id = e.home_team_id
         LEFT JOIN catalog.sport_teams at ON at.id = e.away_team_id
         LEFT JOIN catalog.venues       v  ON v.id  = e.venue_id
         WHERE (e.home_team_id = $1 OR e.away_team_id = $1)
           AND e.promoter_id = $2
           AND e.is_match = true
         ORDER BY e.date_start ASC
         LIMIT 100`,
        [params.id, ctx.promoterId],
      ),
    ]);

    if (teamR.rows.length === 0) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 });
    }

    return NextResponse.json({ team: teamR.rows[0], matches: matchesR.rows });
  });
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: { id: string } },
): Promise<Response> {
  return runAsPromoter(req, async (ctx) => {
    const b = await req.json() as Record<string, unknown>;

    const ALLOWED = [
      'name','short_name','code','sport_type','logo_url',
      'primary_color','secondary_color','city','country',
      'league_name','league_country','founded_year',
      'website_url','stadium_name','status',
    ];

    const fields: string[] = [];
    const values: unknown[] = [];
    let i = 1;

    for (const key of ALLOWED) {
      if (key in b) {
        fields.push(`${key}=$${i++}`);
        values.push(b[key]);
      }
    }

    if (fields.length === 0) {
      return NextResponse.json({ error: 'Nothing to update' }, { status: 400 });
    }

    fields.push(`updated_at=NOW()`);
    values.push(params.id, ctx.promoterId);

    const r = await db().query(
      `UPDATE catalog.sport_teams SET ${fields.join(',')}
       WHERE id = $${i} AND (promoter_id = $${i + 1} OR promoter_id IS NULL)
       RETURNING *`,
      values,
    );

    if (r.rows.length === 0) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 });
    }

    return NextResponse.json({ team: r.rows[0] });
  });
}

export async function DELETE(
  req: NextRequest,
  { params }: { params: { id: string } },
): Promise<Response> {
  return runAsPromoter(req, async (ctx) => {
    const r = await db().query(
      `UPDATE catalog.sport_teams SET status='archived', updated_at=NOW()
       WHERE id=$1 AND promoter_id=$2
       RETURNING id`,
      [params.id, ctx.promoterId],
    );

    if (r.rows.length === 0) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 });
    }

    return NextResponse.json({ ok: true });
  });
}
