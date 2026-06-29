/**
 * GET    /api/platform/travel/hotels/[hotelId] — hotel detail + rooms
 * PATCH  /api/platform/travel/hotels/[hotelId] — update hotel fields
 * DELETE /api/platform/travel/hotels/[hotelId] — delete (only if no bookings)
 */
import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db/rls-pool';
import { requirePlatformAdmin } from '@/lib/platform-auth';

export async function GET(
  req: NextRequest,
  { params }: { params: { hotelId: string } },
): Promise<Response> {
  const admin = await requirePlatformAdmin(req);
  if (!admin) return NextResponse.json({ error: 'FORBIDDEN' }, { status: 403 });

  const client = await db().connect();
  try {
    await client.query('BEGIN');
    await client.query(`SET LOCAL app.is_platform_admin = 'true'`);

    const [hotelRes, roomsRes] = await Promise.all([
      client.query(`SELECT h.*, v.name AS venue_name
                      FROM catalog.travel_hotels h
                      LEFT JOIN catalog.venues v ON v.id = h.venue_id
                     WHERE h.id = $1`, [params.hotelId]),
      client.query(`SELECT * FROM catalog.travel_hotel_rooms
                     WHERE hotel_id = $1 ORDER BY sort_order, name`, [params.hotelId]),
    ]);

    await client.query('COMMIT');

    if (hotelRes.rowCount === 0) return NextResponse.json({ error: 'NOT_FOUND' }, { status: 404 });

    return NextResponse.json({ hotel: hotelRes.rows[0], rooms: roomsRes.rows });
  } catch (err) {
    await client.query('ROLLBACK').catch(() => undefined);
    return NextResponse.json({ error: 'INTERNAL' }, { status: 500 });
  } finally {
    client.release();
  }
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: { hotelId: string } },
): Promise<Response> {
  const admin = await requirePlatformAdmin(req);
  if (!admin) return NextResponse.json({ error: 'FORBIDDEN' }, { status: 403 });

  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: 'INVALID_JSON' }, { status: 400 });
  }

  const client = await db().connect();
  try {
    await client.query('BEGIN');
    await client.query(`SET LOCAL app.is_platform_admin = 'true'`);

    await client.query(
      `UPDATE catalog.travel_hotels
          SET name            = COALESCE($2, name),
              venue_id        = COALESCE($3, venue_id),
              address         = COALESCE($4, address),
              city            = COALESCE($5, city),
              stars           = COALESCE($6, stars),
              description     = COALESCE($7, description),
              amenities       = COALESCE($8, amenities),
              cover_image_url = COALESCE($9, cover_image_url),
              website_url     = COALESCE($10, website_url),
              active          = COALESCE($11, active),
              updated_at      = now()
        WHERE id = $1`,
      [
        params.hotelId,
        body.name ?? null,
        body.venueId ?? null,
        body.address ?? null,
        body.city ?? null,
        body.stars ?? null,
        body.description ?? null,
        body.amenities !== undefined ? JSON.stringify(body.amenities) : null,
        body.coverImageUrl ?? null,
        body.websiteUrl ?? null,
        body.active ?? null,
      ],
    );

    await client.query('COMMIT');
    return NextResponse.json({ updated: true });
  } catch (err) {
    await client.query('ROLLBACK').catch(() => undefined);
    return NextResponse.json({ error: 'INTERNAL' }, { status: 500 });
  } finally {
    client.release();
  }
}

export async function DELETE(
  req: NextRequest,
  { params }: { params: { hotelId: string } },
): Promise<Response> {
  const admin = await requirePlatformAdmin(req);
  if (!admin) return NextResponse.json({ error: 'FORBIDDEN' }, { status: 403 });

  const client = await db().connect();
  try {
    await client.query('BEGIN');
    await client.query(`SET LOCAL app.is_platform_admin = 'true'`);

    const b = await client.query(
      `SELECT 1 FROM orders.travel_bookings tb
        JOIN catalog.event_travel_packages p ON p.id = tb.package_id
       WHERE p.hotel_id = $1 AND tb.status != 'cancelled' LIMIT 1`,
      [params.hotelId],
    );
    if ((b.rowCount ?? 0) > 0) {
      await client.query('ROLLBACK');
      return NextResponse.json({ error: 'HAS_BOOKINGS' }, { status: 409 });
    }

    await client.query(`DELETE FROM catalog.travel_hotels WHERE id = $1`, [params.hotelId]);
    await client.query('COMMIT');
    return NextResponse.json({ deleted: params.hotelId });
  } catch (err) {
    await client.query('ROLLBACK').catch(() => undefined);
    return NextResponse.json({ error: 'INTERNAL' }, { status: 500 });
  } finally {
    client.release();
  }
}
