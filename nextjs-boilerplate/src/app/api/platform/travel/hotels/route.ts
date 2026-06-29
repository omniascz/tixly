/**
 * GET  /api/platform/travel/hotels — list all hotels in catalog
 * POST /api/platform/travel/hotels — create hotel
 */
import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db/rls-pool';
import { requirePlatformAdmin } from '@/lib/platform-auth';

export async function GET(req: NextRequest): Promise<Response> {
  const admin = await requirePlatformAdmin(req);
  if (!admin) return NextResponse.json({ error: 'FORBIDDEN' }, { status: 403 });

  const client = await db().connect();
  try {
    await client.query('BEGIN');
    await client.query(`SET LOCAL app.is_platform_admin = 'true'`);

    const r = await client.query(
      `SELECT h.*,
              v.name AS venue_name,
              (SELECT COUNT(*) FROM catalog.travel_hotel_rooms WHERE hotel_id = h.id) AS room_count
         FROM catalog.travel_hotels h
         LEFT JOIN catalog.venues v ON v.id = h.venue_id
        ORDER BY h.active DESC, h.name`,
    );

    await client.query('COMMIT');
    return NextResponse.json({ hotels: r.rows });
  } catch (err) {
    await client.query('ROLLBACK').catch(() => undefined);
    console.error('[GET /api/platform/travel/hotels]', err);
    return NextResponse.json({ error: 'INTERNAL' }, { status: 500 });
  } finally {
    client.release();
  }
}

export async function POST(req: NextRequest): Promise<Response> {
  const admin = await requirePlatformAdmin(req);
  if (!admin) return NextResponse.json({ error: 'FORBIDDEN' }, { status: 403 });

  let body: {
    name?: string;
    venueId?: string | null;
    address?: string | null;
    city?: string | null;
    stars?: number | null;
    description?: string | null;
    amenities?: string[];
    coverImageUrl?: string | null;
    websiteUrl?: string | null;
  };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: 'INVALID_JSON' }, { status: 400 });
  }

  const name = (body.name ?? '').trim();
  if (!name) return NextResponse.json({ error: 'MISSING_NAME' }, { status: 422 });

  const client = await db().connect();
  try {
    await client.query('BEGIN');
    await client.query(`SET LOCAL app.is_platform_admin = 'true'`);

    const r = await client.query(
      `INSERT INTO catalog.travel_hotels
         (name, venue_id, address, city, stars, description, amenities, cover_image_url, website_url, created_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
       RETURNING *`,
      [
        name,
        body.venueId ?? null,
        body.address ?? null,
        body.city ?? null,
        body.stars ?? null,
        body.description ?? null,
        JSON.stringify(body.amenities ?? []),
        body.coverImageUrl ?? null,
        body.websiteUrl ?? null,
        admin.userId,
      ],
    );

    await client.query('COMMIT');
    return NextResponse.json({ hotel: r.rows[0] }, { status: 201 });
  } catch (err) {
    await client.query('ROLLBACK').catch(() => undefined);
    console.error('[POST /api/platform/travel/hotels]', err);
    return NextResponse.json({ error: 'INTERNAL' }, { status: 500 });
  } finally {
    client.release();
  }
}
