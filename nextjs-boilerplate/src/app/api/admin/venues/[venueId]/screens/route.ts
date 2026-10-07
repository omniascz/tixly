/**
 * GET  /api/admin/venues/[venueId]/screens  — sály daného kina
 * POST /api/admin/venues/[venueId]/screens  — přidat sál
 */

import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db/rls-pool';
import { runAsPromoter } from '@/lib/admin-auth';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest, props: { params: Promise<{ venueId: string }> }): Promise<Response> {
  const params = await props.params;
  return runAsPromoter(req, async (ctx) => {
    const own = await db().query(
      `SELECT id FROM catalog.venues WHERE id=$1 AND promoter_id=$2 LIMIT 1`,
      [params.venueId, ctx.promoterId],
    );
    if (own.rows.length === 0) {
      return NextResponse.json({ error: 'Venue not found' }, { status: 404 });
    }

    const r = await db().query(
      `SELECT cs.*,
              (SELECT COUNT(*) FROM catalog.events e
               WHERE e.cinema_screen_id = cs.id
                 AND e.date_start > NOW() AND e.status = 'published')::int AS upcoming_screenings
       FROM catalog.cinema_screens cs
       WHERE cs.venue_id = $1
       ORDER BY cs.sort_order, cs.name`,
      [params.venueId],
    );

    return NextResponse.json({ screens: r.rows });
  });
}

export async function POST(req: NextRequest, props: { params: Promise<{ venueId: string }> }): Promise<Response> {
  const params = await props.params;
  return runAsPromoter(req, async (ctx) => {
    const own = await db().query(
      `SELECT id FROM catalog.venues WHERE id=$1 AND promoter_id=$2 LIMIT 1`,
      [params.venueId, ctx.promoterId],
    );
    if (own.rows.length === 0) {
      return NextResponse.json({ error: 'Venue not found' }, { status: 404 });
    }

    const b = await req.json() as {
      name: string;
      capacity: number;
      screen_type?: string;
      has_3d?: boolean;
      is_accessible?: boolean;
      sort_order?: number;
    };

    if (!b.name?.trim()) return NextResponse.json({ error: 'name required' }, { status: 400 });
    if (!b.capacity || b.capacity < 1) return NextResponse.json({ error: 'capacity required' }, { status: 400 });

    const r = await db().query(
      `INSERT INTO catalog.cinema_screens
         (venue_id, name, capacity, screen_type, has_3d, is_accessible, sort_order)
       VALUES ($1,$2,$3,$4,$5,$6,$7)
       RETURNING *`,
      [
        params.venueId,
        b.name.trim(),
        b.capacity,
        b.screen_type ?? 'standard',
        b.has_3d ?? false,
        b.is_accessible ?? false,
        b.sort_order ?? 1,
      ],
    );

    return NextResponse.json({ screen: r.rows[0] }, { status: 201 });
  });
}
