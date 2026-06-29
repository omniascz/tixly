/**
 * GET /api/events/[id]/superfan-experiences
 * Veřejný seznam Super Fan zážitků pro danou akci (meet & greet, VIP soundcheck…).
 */
import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db/rls-pool';

export const dynamic = 'force-dynamic';

export async function GET(
  _req: NextRequest,
  { params }: { params: { id: string } },
): Promise<Response> {
  const r = await db().query<{
    id: string; name: string; description: string | null; type: string;
    capacity: number; reserved_count: number; price_halire: number; currency: string;
    requires_ticket: boolean; start_time: string | null; location: string | null;
    what_to_expect: string | null; cover_image_url: string | null; booking_deadline: string | null;
  }>(
    `SELECT id, name, description, type, capacity, reserved_count,
            price_halire, currency, requires_ticket,
            start_time::text, location, what_to_expect, cover_image_url,
            booking_deadline::text
       FROM catalog.superfan_experiences
      WHERE event_id = $1 AND active = true
        AND (booking_deadline IS NULL OR booking_deadline > NOW())
      ORDER BY price_halire DESC`,
    [params.id],
  );

  return NextResponse.json({ experiences: r.rows });
}
