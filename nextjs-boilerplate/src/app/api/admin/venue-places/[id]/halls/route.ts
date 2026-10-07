/**
 * POST /api/admin/venue-places/[id]/halls — nový sál v místě { name } (kolo 8 / krok 2).
 * Sál = catalog.venues (město a adresa z místa); plánek se pak uloží přes /api/admin/venues/[venueId]/seating-chart.
 */
import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { runAsActivePromoter } from '@/lib/admin-auth';
import { db } from '@/lib/db/rls-pool';

export const dynamic = 'force-dynamic';

const schema = z.object({ name: z.string().trim().min(1).max(200) });

export async function POST(req: NextRequest, props: { params: Promise<{ id: string }> }): Promise<Response> {
  const params = await props.params;
  return runAsActivePromoter(req, async (promoter) => {
    if (!/^[0-9a-f-]{36}$/i.test(params.id)) return NextResponse.json({ error: 'BAD_ID' }, { status: 422 });
    const parsed = schema.safeParse(await req.json().catch(() => ({})));
    if (!parsed.success) return NextResponse.json({ error: 'INVALID_BODY', issues: parsed.error.issues }, { status: 422 });
    const place = (await db().query<{ name: string; city: string; address: string | null }>(
      `SELECT name, city, address FROM catalog.venue_places WHERE id = $1 AND promoter_id = $2`,
      [params.id, promoter.promoterId],
    )).rows[0];
    if (!place) return NextResponse.json({ error: 'PLACE_NOT_FOUND' }, { status: 404 });
    const r = await db().query(
      `INSERT INTO catalog.venues (name, address, city, country, capacity, venue_type, promoter_id, place_id, created_at)
       VALUES ($1, $2, $3, 'CZ', 1, 'theatre_hall', $4, $5, now())
       RETURNING id, name, city, capacity`,
      [`${place.name} – ${parsed.data.name}`, place.address ?? place.name, place.city, promoter.promoterId, params.id],
    );
    return NextResponse.json({ hall: r.rows[0] }, { status: 201 });
  });
}
