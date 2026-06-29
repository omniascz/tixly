/**
 * GET  /api/admin/sport-teams  — týmy promotéra
 * POST /api/admin/sport-teams  — přidat tým
 */

import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db/rls-pool';
import { runAsPromoter } from '@/lib/admin-auth';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest): Promise<Response> {
  return runAsPromoter(req, async (ctx) => {
    const sport = req.nextUrl.searchParams.get('sport');

    const r = await db().query(
      `SELECT id, name, short_name, code, sport_type, logo_url, primary_color,
              secondary_color, city, country, league_name, status, created_at
       FROM catalog.sport_teams
       WHERE (promoter_id = $1 OR promoter_id IS NULL)
         AND ($2::text IS NULL OR sport_type = $2)
       ORDER BY sport_type, name
       LIMIT 500`,
      [ctx.promoterId, sport ?? null],
    );

    return NextResponse.json({ teams: r.rows });
  });
}

export async function POST(req: NextRequest): Promise<Response> {
  return runAsPromoter(req, async (ctx) => {
    const b = await req.json() as {
      name: string;
      short_name?: string;
      code?: string;
      sport_type?: string;
      logo_url?: string;
      primary_color?: string;
      secondary_color?: string;
      city?: string;
      country?: string;
      league_name?: string;
      league_country?: string;
      founded_year?: number;
      website_url?: string;
      stadium_name?: string;
    };

    if (!b.name?.trim()) {
      return NextResponse.json({ error: 'name required' }, { status: 400 });
    }

    const r = await db().query(
      `INSERT INTO catalog.sport_teams
         (promoter_id, name, short_name, code, sport_type, logo_url,
          primary_color, secondary_color, city, country, league_name,
          league_country, founded_year, website_url, stadium_name)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)
       RETURNING *`,
      [
        ctx.promoterId,
        b.name.trim(),
        b.short_name?.trim() ?? null,
        b.code?.toUpperCase().trim() ?? null,
        b.sport_type ?? 'football',
        b.logo_url ?? null,
        b.primary_color ?? null,
        b.secondary_color ?? null,
        b.city?.trim() ?? null,
        b.country ?? 'CZ',
        b.league_name?.trim() ?? null,
        b.league_country ?? null,
        b.founded_year ?? null,
        b.website_url ?? null,
        b.stadium_name?.trim() ?? null,
      ],
    );

    return NextResponse.json({ team: r.rows[0] }, { status: 201 });
  });
}
