/**
 * GET /api/events/nearby
 *
 * Query: ?lat=50.07&lng=14.43&radius=50 (km) | ?city=Praha | nic = celá ČR
 *
 * Vrátí published events s GPS souřadnicemi pro map view (Leaflet/Google Maps).
 * Limit 200, sorted by distance ASC pokud GPS.
 */

import { NextRequest, NextResponse } from 'next/server';
import { Pool } from 'pg';

let pool: Pool | null = null;
function db(): Pool {
  if (!pool) pool = new Pool({ connectionString: process.env.DATABASE_URL });
  return pool;
}

interface Row {
  id: string;
  title: string;
  slug: string | null;
  date_start: string;
  city: string | null;
  venue_name: string | null;
  lat: number | null;
  lng: number | null;
  event_type: string | null;
  cover_image: string | null;
  promoter_name: string | null;
  cheapest_price_halire: number | null;
  distance_km: number | null;
}

export async function GET(req: NextRequest): Promise<Response> {
  const sp = req.nextUrl.searchParams;
  const lat = sp.get('lat') ? Number(sp.get('lat')) : null;
  const lng = sp.get('lng') ? Number(sp.get('lng')) : null;
  const radius = Math.min(500, Math.max(1, Number(sp.get('radius') ?? '50')));
  const city = sp.get('city');

  const args: unknown[] = [];
  let whereClause = `WHERE e.status = 'published' AND e.date_start > NOW()`;
  let distanceSelect = `NULL::float AS distance_km`;
  let orderClause = `e.date_start ASC`;

  if (lat !== null && lng !== null && isFinite(lat) && isFinite(lng)) {
    args.push(lat, lng, radius);
    // Haversine approximation in SQL (km)
    distanceSelect = `
      (6371 * acos(
        cos(radians($1)) * cos(radians(v.latitude)) *
        cos(radians(v.longitude) - radians($2)) +
        sin(radians($1)) * sin(radians(v.latitude))
      )) AS distance_km`;
    whereClause += `
      AND v.latitude IS NOT NULL AND v.longitude IS NOT NULL
      AND (6371 * acos(
        cos(radians($1)) * cos(radians(v.latitude)) *
        cos(radians(v.longitude) - radians($2)) +
        sin(radians($1)) * sin(radians(v.latitude))
      )) <= $3`;
    orderClause = `distance_km ASC, e.date_start ASC`;
  } else if (city) {
    args.push(city);
    whereClause += ` AND LOWER(v.city) = LOWER($${args.length})`;
  }

  const r = await db().query<Row>(
    `SELECT
       e.id, e.title, e.slug, e.date_start::text,
       v.city, v.name AS venue_name, v.latitude AS lat, v.longitude AS lng,
       e.event_type, e.cover_image,
       p.name AS promoter_name,
       (SELECT MIN(tt.base_price)
        FROM catalog.ticket_types tt
        WHERE tt.event_id = e.id AND tt.remaining_qty > 0) AS cheapest_price_halire,
       ${distanceSelect}
     FROM catalog.events e
     LEFT JOIN catalog.venues v ON v.id = e.venue_id
     LEFT JOIN platform.promoters p ON p.id = e.promoter_id
     ${whereClause}
     ORDER BY ${orderClause}
     LIMIT 200`,
    args,
  );

  return NextResponse.json({
    center: lat !== null && lng !== null ? { lat, lng, radius } : null,
    count: r.rows.length,
    events: r.rows.map((row) => ({
      id: row.id,
      title: row.title,
      slug: row.slug,
      dateStart: row.date_start,
      city: row.city,
      venueName: row.venue_name,
      lat: row.lat,
      lng: row.lng,
      eventType: row.event_type,
      coverImage: row.cover_image,
      promoterName: row.promoter_name,
      cheapestPriceHalire: row.cheapest_price_halire,
      distanceKm: row.distance_km !== null ? Math.round(row.distance_km * 10) / 10 : null,
    })),
  });
}
