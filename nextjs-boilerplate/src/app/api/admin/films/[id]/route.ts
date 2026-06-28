/**
 * GET    /api/admin/films/[id]  — detail + promítání
 * PATCH  /api/admin/films/[id]  — editovat film
 * DELETE /api/admin/films/[id]  — archivovat (soft delete)
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
    const [filmR, screeningsR] = await Promise.all([
      db().query(
        `SELECT * FROM catalog.films
         WHERE id = $1 AND (promoter_id = $2 OR promoter_id IS NULL)`,
        [params.id, ctx.promoterId],
      ),
      db().query(
        `SELECT
           e.id, e.title, e.date_start, e.status,
           e.screening_format, e.screening_language,
           cs.name AS screen_name,
           cs.screen_type,
           v.name  AS venue_name, v.city AS venue_city,
           (SELECT COUNT(*) FROM tickets.tickets t
             JOIN orders.orders o ON o.id = t.order_id
             WHERE o.event_id = e.id AND o.status = 'paid')::int AS tickets_sold,
           (SELECT MIN(tt.price) FROM catalog.ticket_types tt WHERE tt.event_id = e.id)::int AS price_from
         FROM catalog.events e
         LEFT JOIN catalog.cinema_screens cs ON cs.id = e.cinema_screen_id
         LEFT JOIN catalog.venues          v  ON v.id  = e.venue_id
         WHERE e.film_id = $1 AND e.promoter_id = $2
         ORDER BY e.date_start ASC
         LIMIT 100`,
        [params.id, ctx.promoterId],
      ),
    ]);

    if (filmR.rows.length === 0) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 });
    }

    return NextResponse.json({ film: filmR.rows[0], screenings: screeningsR.rows });
  });
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: { id: string } },
): Promise<Response> {
  return runAsPromoter(req, async (ctx) => {
    const b = await req.json() as Record<string, unknown>;

    const ALLOWED = [
      'title','original_title','synopsis','poster_url','backdrop_url',
      'trailer_url','duration_minutes','age_rating','genre','director',
      'cast_main','language','original_language','country','release_year',
      'imdb_id','distributor','status',
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
      `UPDATE catalog.films SET ${fields.join(',')}
       WHERE id = $${i} AND (promoter_id = $${i + 1} OR promoter_id IS NULL)
       RETURNING *`,
      values,
    );

    if (r.rows.length === 0) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 });
    }

    return NextResponse.json({ film: r.rows[0] });
  });
}

export async function DELETE(
  req: NextRequest,
  { params }: { params: { id: string } },
): Promise<Response> {
  return runAsPromoter(req, async (ctx) => {
    const r = await db().query(
      `UPDATE catalog.films SET status='archived', updated_at=NOW()
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
