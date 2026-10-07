/**
 * GET /api/events/[id]/travel-packages
 *
 * Veřejný endpoint — vrací dostupné hotelové balíčky pro daný event.
 * Buyer je zobrazí v checkout stránce v sekci "Ubytování".
 *
 * JOIN na catalog.events s e.status = 'published' je BEZPEČNOSTNÍ, ne kosmetický
 * (FINDINGS 97 / R-13): tabulky travel_* mají policy USING (true), takže RLS tuhle
 * routu nijak nedrží. Bez toho JOINu vydá uhodnuté UUID rozpracované akce její
 * ceny, hotely a kapacity dřív, než je akce zveřejněná. Vzorec je týž jako
 * u sousedních rout events/[id]/{accreditation,calendar}.
 */
import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db/rls-pool';

interface PackageRow {
  id: string;
  hotel_id: string;
  hotel_name: string;
  hotel_address: string | null;
  hotel_city: string | null;
  hotel_stars: number | null;
  hotel_cover_image_url: string | null;
  hotel_website_url: string | null;
  room_id: string;
  room_name: string;
  room_capacity: number;
  room_breakfast_included: boolean;
  room_description: string | null;
  checkin_date: string;
  checkout_date: string;
  nights: number;
  total_capacity: number;
  reserved_count: number;
  price_per_night_halire: number;
  display_order: number;
}

export async function GET(_req: NextRequest, props: { params: Promise<{ id: string }> }): Promise<Response> {
  const params = await props.params;
  const client = await db().connect();
  try {
    const r = await client.query<PackageRow>(
      `SELECT
         p.id,
         p.hotel_id,
         h.name            AS hotel_name,
         h.address         AS hotel_address,
         h.city            AS hotel_city,
         h.stars           AS hotel_stars,
         h.cover_image_url AS hotel_cover_image_url,
         h.website_url     AS hotel_website_url,
         r.id              AS room_id,
         r.name            AS room_name,
         r.capacity        AS room_capacity,
         r.breakfast_included AS room_breakfast_included,
         r.description     AS room_description,
         p.checkin_date,
         p.checkout_date,
         p.nights,
         p.total_capacity,
         p.reserved_count,
         COALESCE(p.price_per_night_override_halire, r.price_per_night_halire) AS price_per_night_halire,
         p.display_order
       FROM catalog.event_travel_packages p
       JOIN catalog.events e
         ON e.id = p.event_id
        AND e.status = 'published'
       JOIN catalog.travel_hotels h ON h.id = p.hotel_id
       JOIN catalog.travel_hotel_rooms r ON r.id = p.hotel_room_id
       WHERE p.event_id = $1
         AND p.active = true
         AND h.active = true
         AND r.active = true
         AND (p.total_capacity = 0 OR p.reserved_count < p.total_capacity)
       ORDER BY p.display_order, h.stars DESC, p.price_per_night_override_halire NULLS LAST`,
      [params.id],
    );

    const packages = r.rows.map((row) => ({
      id: row.id,
      hotelId: row.hotel_id,
      hotelName: row.hotel_name,
      hotelAddress: row.hotel_address,
      hotelCity: row.hotel_city,
      hotelStars: row.hotel_stars,
      hotelCoverImageUrl: row.hotel_cover_image_url,
      hotelWebsiteUrl: row.hotel_website_url,
      roomId: row.room_id,
      roomName: row.room_name,
      roomCapacity: row.room_capacity,
      roomBreakfastIncluded: row.room_breakfast_included,
      roomDescription: row.room_description,
      checkinDate: row.checkin_date,
      checkoutDate: row.checkout_date,
      nights: row.nights,
      availableCount: row.total_capacity === 0 ? null : row.total_capacity - row.reserved_count,
      pricePerNightHalire: row.price_per_night_halire,
      totalPriceHalire: row.price_per_night_halire * row.nights,
    }));

    return NextResponse.json({ packages });
  } catch (err) {
    console.error('[GET /api/events/:id/travel-packages]', err);
    return NextResponse.json({ error: 'INTERNAL' }, { status: 500 });
  } finally {
    client.release();
  }
}
