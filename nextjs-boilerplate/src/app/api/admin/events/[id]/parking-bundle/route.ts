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

export async function GET(req: NextRequest, { params }: { params: { id: string } }): Promise<Response> {
  return runAsPromoter(req, async (ctx) => {
    if (!(await assertOwner(params.id, ctx.promoterId))) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }
    const r = await runWithServiceContext(() =>
      db().query(
        `SELECT id, name, description, address, lat, lng, distance_meters,
                vehicle_types, height_limit_cm, price_halire, capacity, reserved_count,
                access_instructions, booking_deadline, confirmation_prefix,
                active, sort_order, created_at
         FROM catalog.parking_offers
         WHERE event_id=$1
         ORDER BY sort_order, created_at`,
        [params.id],
      ),
    );
    return NextResponse.json({ offers: r.rows });
  });
}

export async function POST(req: NextRequest, { params }: { params: { id: string } }): Promise<Response> {
  return runAsPromoter(req, async (ctx) => {
    if (!(await assertOwner(params.id, ctx.promoterId))) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }
    const b = await req.json() as {
      name: string; description?: string; address?: string;
      lat?: number; lng?: number; distance_meters?: number;
      vehicle_types?: string[]; height_limit_cm?: number;
      price_halire?: number; capacity?: number;
      access_instructions?: string; booking_deadline?: string;
      confirmation_prefix?: string; sort_order?: number;
    };
    if (!b.name) return NextResponse.json({ error: 'name required' }, { status: 400 });
    const r = await runWithServiceContext(() =>
      db().query(
        `INSERT INTO catalog.parking_offers
           (event_id, name, description, address, lat, lng, distance_meters,
            vehicle_types, height_limit_cm, price_halire, capacity,
            access_instructions, booking_deadline, confirmation_prefix, sort_order)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)
         RETURNING *`,
        [
          params.id, b.name, b.description ?? null, b.address ?? null,
          b.lat ?? null, b.lng ?? null, b.distance_meters ?? null,
          b.vehicle_types ?? ['car'], b.height_limit_cm ?? null,
          b.price_halire ?? 0, b.capacity ?? 0,
          b.access_instructions ?? null, b.booking_deadline ?? null,
          b.confirmation_prefix ?? 'PKG', b.sort_order ?? 0,
        ],
      ),
    );
    return NextResponse.json(r.rows[0], { status: 201 });
  });
}
