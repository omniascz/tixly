/**
 * GET /api/events/[id]/travel-bundles
 * Veřejný endpoint — parking + accommodation nabídky pro checkout.
 */

import { NextRequest, NextResponse } from 'next/server';
import { db, runWithServiceContext } from '@/lib/db/rls-pool';

export const dynamic = 'force-dynamic';

export async function GET(
  _req: NextRequest,
  { params }: { params: { id: string } },
): Promise<Response> {
  if (!/^[0-9a-f-]{36}$/i.test(params.id)) {
    return NextResponse.json({ parking: [], accommodation: [] });
  }

  const [parkingRes, accomRes] = await Promise.all([
    runWithServiceContext(() =>
      db().query(
        `SELECT id, name, description, address, lat, lng, distance_meters,
                vehicle_types, height_limit_cm, price_halire,
                capacity, reserved_count, access_instructions,
                booking_deadline, sort_order
         FROM catalog.parking_offers
         WHERE event_id=$1 AND active=true
           AND (booking_deadline IS NULL OR booking_deadline > NOW())
           AND (capacity = 0 OR reserved_count < capacity)
         ORDER BY sort_order, price_halire`,
        [params.id],
      ),
    ),
    runWithServiceContext(() =>
      db().query(
        `SELECT id, name, description, address, lat, lng, distance_meters,
                stars, room_type, breakfast_included,
                price_per_night_halire, base_nights,
                check_in_date, check_out_date,
                partner_url, cancellation_policy, sort_order
         FROM catalog.accommodation_offers
         WHERE event_id=$1 AND active=true
         ORDER BY sort_order, stars DESC NULLS LAST`,
        [params.id],
      ),
    ),
  ]);

  return NextResponse.json({
    parking: parkingRes.rows,
    accommodation: accomRes.rows,
  });
}
