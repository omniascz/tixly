/**
 * GET  /api/admin/events/[id]/travel  — list travel packages for event
 * POST /api/admin/events/[id]/travel  — add travel package to event
 */
import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db/rls-pool';
import { runAsPromoter } from '@/lib/admin-auth';

export async function GET(req: NextRequest, props: { params: Promise<{ id: string }> }): Promise<Response> {
  const params = await props.params;
  return runAsPromoter(req, async (ctx) => {
    const client = await db().connect();
    try {
      // Verify event belongs to promoter
      const own = await client.query(
        `SELECT 1 FROM catalog.events WHERE id = $1 AND promoter_id = $2`,
        [params.id, ctx.promoterId],
      );
      if (own.rowCount === 0) return NextResponse.json({ error: 'FORBIDDEN' }, { status: 403 });

      const r = await client.query(
        `SELECT
           p.id, p.hotel_id, p.hotel_room_id,
           h.name AS hotel_name, h.city, h.stars, h.cover_image_url,
           r.name AS room_name, r.price_per_night_halire AS room_base_price,
           r.breakfast_included AS room_breakfast_included,
           p.checkin_date, p.checkout_date, p.nights,
           p.total_capacity, p.reserved_count,
           p.price_per_night_override_halire,
           COALESCE(p.price_per_night_override_halire, r.price_per_night_halire) AS effective_price_per_night,
           p.active, p.display_order, p.created_at
         FROM catalog.event_travel_packages p
         JOIN catalog.travel_hotels h ON h.id = p.hotel_id
         JOIN catalog.travel_hotel_rooms r ON r.id = p.hotel_room_id
         WHERE p.event_id = $1
         ORDER BY p.display_order, p.created_at`,
        [params.id],
      );

      return NextResponse.json({ packages: r.rows });
    } finally {
      client.release();
    }
  });
}

export async function POST(req: NextRequest, props: { params: Promise<{ id: string }> }): Promise<Response> {
  const params = await props.params;
  return runAsPromoter(req, async (ctx) => {
    let body: {
      hotelId?: string;
      hotelRoomId?: string;
      checkinDate?: string;
      checkoutDate?: string;
      totalCapacity?: number;
      pricePerNightOverrideHalire?: number | null;
      displayOrder?: number;
    };
    try {
      body = (await req.json()) as typeof body;
    } catch {
      return NextResponse.json({ error: 'INVALID_JSON' }, { status: 400 });
    }

    const { hotelId, hotelRoomId, checkinDate, checkoutDate } = body;
    if (!hotelId || !hotelRoomId || !checkinDate || !checkoutDate) {
      return NextResponse.json({ error: 'MISSING_FIELDS' }, { status: 422 });
    }
    if (new Date(checkoutDate) <= new Date(checkinDate)) {
      return NextResponse.json({ error: 'CHECKOUT_MUST_BE_AFTER_CHECKIN' }, { status: 422 });
    }

    const client = await db().connect();
    try {
      // Verify event belongs to promoter
      const own = await client.query(
        `SELECT 1 FROM catalog.events WHERE id = $1 AND promoter_id = $2`,
        [params.id, ctx.promoterId],
      );
      if (own.rowCount === 0) return NextResponse.json({ error: 'FORBIDDEN' }, { status: 403 });

      // Verify hotel + room exist and are active
      const hotelCheck = await client.query(
        `SELECT 1 FROM catalog.travel_hotels h
           JOIN catalog.travel_hotel_rooms r ON r.hotel_id = h.id
          WHERE h.id = $1 AND r.id = $2 AND h.active = true AND r.active = true`,
        [hotelId, hotelRoomId],
      );
      if (hotelCheck.rowCount === 0) {
        return NextResponse.json({ error: 'HOTEL_OR_ROOM_NOT_FOUND' }, { status: 404 });
      }

      const r = await client.query<{ id: string }>(
        `INSERT INTO catalog.event_travel_packages
           (event_id, hotel_id, hotel_room_id, checkin_date, checkout_date,
            total_capacity, price_per_night_override_halire, display_order, created_by)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
         RETURNING id`,
        [
          params.id,
          hotelId,
          hotelRoomId,
          checkinDate,
          checkoutDate,
          body.totalCapacity ?? 0,
          body.pricePerNightOverrideHalire ?? null,
          body.displayOrder ?? 0,
          ctx.userId,
        ],
      );

      return NextResponse.json({ packageId: r.rows[0].id }, { status: 201 });
    } finally {
      client.release();
    }
  });
}
