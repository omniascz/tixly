/**
 * GET   /api/admin/productions/[id] — karta inscenace + všechny její termíny (pořadatel).
 * PATCH /api/admin/productions/[id] — úprava karty; termíny ji přebírají (veřejný web čte z inscenace).
 * Kolo 8 / krok 1.
 */
import { NextRequest, NextResponse } from 'next/server';
import { runAsActivePromoter } from '@/lib/admin-auth';
import { db } from '@/lib/db/rls-pool';
import {
  cardColumns,
  PRODUCTION_COLUMNS,
  productionCardSchema,
  toProductionCard,
  type ProductionRow,
} from '@/lib/theatre/production-card';

export const dynamic = 'force-dynamic';
const UUID = /^[0-9a-f-]{36}$/i;

export async function GET(req: NextRequest, { params }: { params: { id: string } }): Promise<Response> {
  return runAsActivePromoter(req, async (promoter) => {
    if (!UUID.test(params.id)) return NextResponse.json({ error: 'BAD_ID' }, { status: 422 });
    const r = await db().query<ProductionRow>(
      `SELECT ${PRODUCTION_COLUMNS} FROM catalog.productions p WHERE p.id = $1 AND p.promoter_id = $2`,
      [params.id, promoter.promoterId],
    );
    if (!r.rows[0]) return NextResponse.json({ error: 'NOT_FOUND' }, { status: 404 });
    const terms = await db().query(
      `SELECT e.id, e.date_start::text AS "dateStart", e.status, e.term_note AS "termNote", e.cast_alternation AS "castAlternation",
              v.id AS "venueId", v.name AS "venueName", v.city,
              (SELECT count(*)::int FROM catalog.event_seats s WHERE s.event_id = e.id) AS capacity,
              (SELECT count(*)::int FROM catalog.event_seats s WHERE s.event_id = e.id AND s.status = 'sold') AS sold
         FROM catalog.events e LEFT JOIN catalog.venues v ON v.id = e.venue_id
        WHERE e.production_id = $1 AND e.promoter_id = $2
        ORDER BY e.date_start`,
      [params.id, promoter.promoterId],
    );
    return NextResponse.json({ production: toProductionCard(r.rows[0]), terms: terms.rows });
  });
}

export async function PATCH(req: NextRequest, { params }: { params: { id: string } }): Promise<Response> {
  return runAsActivePromoter(req, async (promoter) => {
    if (!UUID.test(params.id)) return NextResponse.json({ error: 'BAD_ID' }, { status: 422 });
    const parsed = productionCardSchema.partial().safeParse(await req.json().catch(() => ({})));
    if (!parsed.success) return NextResponse.json({ error: 'INVALID_BODY', issues: parsed.error.issues }, { status: 422 });
    const cols = cardColumns(parsed.data);
    if (parsed.data.slug !== undefined) cols.push(['slug', parsed.data.slug]);
    if (cols.length === 0) return NextResponse.json({ error: 'NOTHING_TO_UPDATE' }, { status: 422 });
    const r = await db().query<ProductionRow>(
      `UPDATE catalog.productions p SET ${cols.map(([c], i) => `${c} = $${i + 3}`).join(', ')}, updated_at = now()
        WHERE p.id = $1 AND p.promoter_id = $2 RETURNING ${PRODUCTION_COLUMNS}`,
      [params.id, promoter.promoterId, ...cols.map(([, v]) => v)],
    );
    if (!r.rows[0]) return NextResponse.json({ error: 'NOT_FOUND' }, { status: 404 });
    // Termíny přebírají název a popis z inscenace (pro vyhledávání a karty akcí na webu).
    if (parsed.data.title !== undefined || parsed.data.description !== undefined) {
      await db().query(
        `UPDATE catalog.events SET title = $3, description = $4, updated_at = now() WHERE production_id = $1 AND promoter_id = $2`,
        [params.id, promoter.promoterId, r.rows[0].title, r.rows[0].description],
      );
    }
    return NextResponse.json({ production: toProductionCard(r.rows[0]) });
  });
}
