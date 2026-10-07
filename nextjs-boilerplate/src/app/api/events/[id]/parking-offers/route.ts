/**
 * GET /api/events/[id]/parking-offers
 * Veřejný seznam aktivních parkovacích nabídek k akci.
 * Checkout stránka je načítá pro výběr parkovacího místa.
 */
import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db/rls-pool';

export const dynamic = 'force-dynamic';

export async function GET(_req: NextRequest, props: { params: Promise<{ id: string }> }): Promise<Response> {
  const params = await props.params;
  const r = await db().query<{
    id: string; name: string; description: string | null;
    address: string | null; lat: number | null; lng: number | null;
    distance_meters: number | null; vehicle_types: string[];
    height_limit_cm: number | null; price_halire: number;
    capacity: number; reserved_count: number;
    access_instructions: string | null; booking_deadline: string | null;
    confirmation_prefix: string;
  }>(
    `SELECT id, name, description, address,
            lat::float, lng::float, distance_meters,
            vehicle_types, height_limit_cm, price_halire,
            capacity, reserved_count, access_instructions,
            booking_deadline::text, confirmation_prefix
       FROM catalog.parking_offers
      WHERE event_id = $1 AND active = true
        AND (booking_deadline IS NULL OR booking_deadline > NOW())
      ORDER BY sort_order, price_halire ASC`,
    [params.id],
  );

  return NextResponse.json({ offers: r.rows });
}
