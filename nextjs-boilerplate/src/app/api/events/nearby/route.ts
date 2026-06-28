/**
 * GET /api/events/nearby
 *
 * Query params:
 *   lat, lng, radius (km) — geo search
 *   city               — exact city name match
 *   category           — event category filter
 *   dateFrom, dateTo   — ISO date range (YYYY-MM-DD)
 *   bbox               — "minLat,minLng,maxLat,maxLng" (viewport filter)
 *
 * Vrátí published events s GPS souřadnicemi pro Leaflet map view.
 * Limit 300, sorted by distance ASC pokud GPS, jinak date_start ASC.
 */

import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db/rls-pool';

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
  category: string | null;
  cover_image: string | null;
  promoter_name: string | null;
  cheapest_price_halire: number | null;
  distance_km: number | null;
}

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest): Promise<Response> {
  const sp = req.nextUrl.searchParams;

  const lat      = sp.get('lat')  ? Number(sp.get('lat'))  : null;
  const lng      = sp.get('lng')  ? Number(sp.get('lng'))  : null;
  const radius   = Math.min(500, Math.max(1, Number(sp.get('radius') ?? '50')));
  const city     = sp.get('city');
  const category = sp.get('category');
  const dateFrom = sp.get('dateFrom');
  const dateTo   = sp.get('dateTo');
  const bboxRaw  = sp.get('bbox');

  const args: unknown[] = [];
  let whereClause = `WHERE e.status = 'published' AND e.date_start > NOW()`;
  let distanceSelect = `NULL::float AS distance_km`;
  let orderClause    = `e.date_start ASC`;

  // Geo filter — Haversine
  if (lat !== null && lng !== null && isFinite(lat) && isFinite(lng)) {
    args.push(lat, lng, radius);
    distanceSelect = `
      (6371 * acos(GREATEST(-1, LEAST(1,
        cos(radians($1)) * cos(radians(v.gps_lat)) *
        cos(radians(v.gps_lng) - radians($2)) +
        sin(radians($1)) * sin(radians(v.gps_lat))
      )))) AS distance_km`;
    whereClause += `
      AND v.gps_lat IS NOT NULL AND v.gps_lng IS NOT NULL
      AND (6371 * acos(GREATEST(-1, LEAST(1,
        cos(radians($1)) * cos(radians(v.gps_lat)) *
        cos(radians(v.gps_lng) - radians($2)) +
        sin(radians($1)) * sin(radians(v.gps_lat))
      )))) <= $3`;
    orderClause = `distance_km ASC, e.date_start ASC`;
  }

  // City filter
  if (city) {
    args.push(`%${city}%`);
    whereClause += ` AND v.city ILIKE $${args.length}`;
  }

  // Bounding box (viewport filter — bez nutnosti nového dotazu při scrolu mapy)
  if (bboxRaw && /^-?[\d.]+,-?[\d.]+,-?[\d.]+,-?[\d.]+$/.test(bboxRaw)) {
    const [minLat, minLng, maxLat, maxLng] = bboxRaw.split(',').map(Number);
    args.push(minLat, minLng, maxLat, maxLng);
    const n = args.length;
    whereClause += ` AND v.gps_lat BETWEEN $${n - 3} AND $${n - 1}
                    AND v.gps_lng BETWEEN $${n - 2} AND $${n}`;
  }

  // Category filter
  if (category) {
    args.push(category);
    whereClause += ` AND e.category = $${args.length}`;
  }

  // Date range
  if (dateFrom) {
    args.push(dateFrom);
    whereClause += ` AND e.date_start >= $${args.length}::date`;
  }
  if (dateTo) {
    args.push(dateTo);
    whereClause += ` AND e.date_start < ($${args.length}::date + INTERVAL '1 day')`;
  }

  const r = await db().query<Row>(
    `SELECT
       e.id, e.title, e.slug, e.date_start::text,
       v.city, v.name AS venue_name, v.gps_lat AS lat, v.gps_lng AS lng,
       e.event_type, e.category, e.cover_image_url AS cover_image,
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
     LIMIT 300`,
    args,
  );

  // Dostupné kategorie pro filter chips (z výsledku, ne globálně)
  const categories = [...new Set(r.rows.map((row) => row.category).filter(Boolean))].sort();

  return NextResponse.json({
    center:     lat !== null && lng !== null ? { lat, lng, radius } : null,
    count:      r.rows.length,
    categories,
    events:     r.rows.map((row) => ({
      id:                  row.id,
      title:               row.title,
      slug:                row.slug,
      dateStart:           row.date_start,
      city:                row.city,
      venueName:           row.venue_name,
      lat:                 row.lat,
      lng:                 row.lng,
      eventType:           row.event_type,
      category:            row.category,
      coverImage:          row.cover_image,
      promoterName:        row.promoter_name,
      cheapestPriceHalire: row.cheapest_price_halire,
      distanceKm:          row.distance_km !== null ? Math.round(row.distance_km * 10) / 10 : null,
    })),
  });
}
