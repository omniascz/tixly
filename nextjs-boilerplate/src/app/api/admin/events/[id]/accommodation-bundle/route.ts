import { NextRequest, NextResponse } from 'next/server';
import { db, runWithServiceContext } from '@/lib/db/rls-pool';
import { runAsPromoter } from '@/lib/admin-auth';

export const dynamic = 'force-dynamic';

async function assertOwner(eventId: string, promoterId: string): Promise<boolean> {
  const r = await runWithServiceContext(() =>
    db().query(`SELECT 1 FROM catalog.events WHERE id=$1 AND promoter_id=$2 LIMIT 1`, [eventId, promoterId]),
  );
  return r.rows.length > 0;
}

export async function GET(req: NextRequest, props: { params: Promise<{ id: string }> }): Promise<Response> {
  const params = await props.params;
  return runAsPromoter(req, async (ctx) => {
    if (!(await assertOwner(params.id, ctx.promoterId))) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }
    const r = await runWithServiceContext(() =>
      db().query(
        `SELECT id, name, description, address, lat, lng, distance_meters,
                stars, room_type, breakfast_included,
                price_per_night_halire, base_nights,
                check_in_date, check_out_date,
                partner_url, cancellation_policy,
                active, sort_order, created_at
         FROM catalog.accommodation_offers
         WHERE event_id=$1
         ORDER BY sort_order, created_at`,
        [params.id],
      ),
    );
    return NextResponse.json({ offers: r.rows });
  });
}

export async function POST(req: NextRequest, props: { params: Promise<{ id: string }> }): Promise<Response> {
  const params = await props.params;
  return runAsPromoter(req, async (ctx) => {
    if (!(await assertOwner(params.id, ctx.promoterId))) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }
    const b = await req.json() as {
      name: string; description?: string; address?: string;
      lat?: number; lng?: number; distance_meters?: number;
      stars?: number; room_type?: string; breakfast_included?: boolean;
      price_per_night_halire?: number; base_nights?: number;
      check_in_date?: string; check_out_date?: string;
      partner_url?: string; cancellation_policy?: string;
      sort_order?: number;
    };
    if (!b.name) return NextResponse.json({ error: 'name required' }, { status: 400 });
    const r = await runWithServiceContext(() =>
      db().query(
        `INSERT INTO catalog.accommodation_offers
           (event_id, name, description, address, lat, lng, distance_meters,
            stars, room_type, breakfast_included,
            price_per_night_halire, base_nights,
            check_in_date, check_out_date,
            partner_url, cancellation_policy, sort_order)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17)
         RETURNING *`,
        [
          params.id, b.name, b.description ?? null, b.address ?? null,
          b.lat ?? null, b.lng ?? null, b.distance_meters ?? null,
          b.stars ?? null, b.room_type ?? 'double', b.breakfast_included ?? false,
          b.price_per_night_halire ?? 0, b.base_nights ?? 1,
          b.check_in_date ?? null, b.check_out_date ?? null,
          b.partner_url ?? null, b.cancellation_policy ?? null,
          b.sort_order ?? 0,
        ],
      ),
    );
    return NextResponse.json(r.rows[0], { status: 201 });
  });
}
