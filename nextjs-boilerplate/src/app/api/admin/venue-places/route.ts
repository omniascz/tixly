/**
 * Knihovna míst pořadatele (kolo 8 / krok 2): místo (název, město, adresa) → sály → plánek.
 *   GET  /api/admin/venue-places — místa se sály (kapacita, má plánek, cenové zóny)
 *   POST /api/admin/venue-places — nové místo { name, city, address? }
 * Sál uložený jednou se použije pro libovolný další termín.
 */
import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { runAsActivePromoter } from '@/lib/admin-auth';
import { db } from '@/lib/db/rls-pool';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest): Promise<Response> {
  return runAsActivePromoter(req, async (promoter) => {
    const places = await db().query<{ id: string; name: string; city: string; address: string | null }>(
      `SELECT id, name, city, address FROM catalog.venue_places WHERE promoter_id = $1 ORDER BY city, name`,
      [promoter.promoterId],
    );
    const halls = await db().query<{ id: string; place_id: string; name: string; capacity: number; chart_id: string | null; zones: unknown }>(
      `SELECT v.id, v.place_id, v.name, v.capacity,
              c.id AS chart_id, COALESCE(c.layout->'zones', '[]'::jsonb) AS zones
         FROM catalog.venues v
         LEFT JOIN LATERAL (SELECT id, layout FROM catalog.venue_seating_charts
                             WHERE venue_id = v.id AND active = true ORDER BY created_at DESC LIMIT 1) c ON true
        WHERE v.promoter_id = $1 AND v.place_id IS NOT NULL AND v.archived_at IS NULL
        ORDER BY v.name`,
      [promoter.promoterId],
    );
    return NextResponse.json({
      places: places.rows.map((p) => ({
        ...p,
        halls: halls.rows.filter((h) => h.place_id === p.id).map((h) => ({
          id: h.id, name: h.name, capacity: h.capacity, hasChart: h.chart_id !== null, zones: h.zones,
        })),
      })),
    });
  });
}

const schema = z.object({
  name: z.string().trim().min(1).max(200),
  city: z.string().trim().min(1).max(100),
  address: z.string().trim().max(300).nullable().optional(),
});

export async function POST(req: NextRequest): Promise<Response> {
  return runAsActivePromoter(req, async (promoter) => {
    const parsed = schema.safeParse(await req.json().catch(() => ({})));
    if (!parsed.success) return NextResponse.json({ error: 'INVALID_BODY', issues: parsed.error.issues }, { status: 422 });
    const r = await db().query(
      `INSERT INTO catalog.venue_places (promoter_id, name, city, address) VALUES ($1, $2, $3, $4)
       RETURNING id, name, city, address`,
      [promoter.promoterId, parsed.data.name, parsed.data.city, parsed.data.address ?? null],
    );
    return NextResponse.json({ place: r.rows[0] }, { status: 201 });
  });
}
