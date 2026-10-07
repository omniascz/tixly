/**
 * GET  /api/platform/travel/hotels/[hotelId]/rooms — list rooms
 * POST /api/platform/travel/hotels/[hotelId]/rooms — add room type
 */
import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db/rls-pool';
import { requirePlatformAdmin } from '@/lib/platform-auth';

export async function GET(req: NextRequest, props: { params: Promise<{ hotelId: string }> }): Promise<Response> {
  const params = await props.params;
  const admin = await requirePlatformAdmin(req);
  if (!admin) return NextResponse.json({ error: 'FORBIDDEN' }, { status: 403 });

  const client = await db().connect();
  try {
    await client.query('BEGIN');
    await client.query(`SET LOCAL app.is_platform_admin = 'true'`);
    const r = await client.query(
      `SELECT * FROM catalog.travel_hotel_rooms WHERE hotel_id = $1 ORDER BY sort_order, name`,
      [params.hotelId],
    );
    await client.query('COMMIT');
    return NextResponse.json({ rooms: r.rows });
  } catch (err) {
    await client.query('ROLLBACK').catch(() => undefined);
    return NextResponse.json({ error: 'INTERNAL' }, { status: 500 });
  } finally {
    client.release();
  }
}

export async function POST(req: NextRequest, props: { params: Promise<{ hotelId: string }> }): Promise<Response> {
  const params = await props.params;
  const admin = await requirePlatformAdmin(req);
  if (!admin) return NextResponse.json({ error: 'FORBIDDEN' }, { status: 403 });

  let body: {
    name?: string;
    capacity?: number;
    pricePerNightHalire?: number;
    breakfastIncluded?: boolean;
    description?: string | null;
    sortOrder?: number;
  };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: 'INVALID_JSON' }, { status: 400 });
  }

  const name = (body.name ?? '').trim();
  if (!name) return NextResponse.json({ error: 'MISSING_NAME' }, { status: 422 });
  if (!body.pricePerNightHalire || body.pricePerNightHalire < 0)
    return NextResponse.json({ error: 'INVALID_PRICE' }, { status: 422 });

  const client = await db().connect();
  try {
    await client.query('BEGIN');
    await client.query(`SET LOCAL app.is_platform_admin = 'true'`);

    const r = await client.query(
      `INSERT INTO catalog.travel_hotel_rooms
         (hotel_id, name, capacity, price_per_night_halire, breakfast_included, description, sort_order)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       RETURNING *`,
      [
        params.hotelId,
        name,
        body.capacity ?? 2,
        body.pricePerNightHalire,
        body.breakfastIncluded ?? false,
        body.description ?? null,
        body.sortOrder ?? 0,
      ],
    );

    await client.query('COMMIT');
    return NextResponse.json({ room: r.rows[0] }, { status: 201 });
  } catch (err) {
    await client.query('ROLLBACK').catch(() => undefined);
    return NextResponse.json({ error: 'INTERNAL' }, { status: 500 });
  } finally {
    client.release();
  }
}
