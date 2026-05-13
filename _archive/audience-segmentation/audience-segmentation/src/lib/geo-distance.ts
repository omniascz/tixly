/**
 * geo-distance.ts
 *
 * Builds a parameterised WHERE fragment selecting users within N kilometres
 * of a venue. Uses PostGIS ST_DWithin when available; falls back to a pure-SQL
 * haversine expression otherwise.
 *
 * Schema assumption:
 *   identity.users.lat  DOUBLE PRECISION
 *   identity.users.lng  DOUBLE PRECISION
 *   venues.venues(id, lat, lng)
 */

export interface GeoDistanceFilter {
  venueId: string;
  distanceKm: number;
}

export interface GeoWhereFragment {
  sql: string;
  params: unknown[];
}

/**
 * Haversine-based SQL fragment (no PostGIS required).
 *
 * 6371 = Earth radius in km.
 * Inputs: venue lat/lng are resolved via subselect from venues.venues.
 */
export function buildDistanceFromVenueClause(
  filter: GeoDistanceFilter,
): GeoWhereFragment {
  if (!Number.isFinite(filter.distanceKm) || filter.distanceKm <= 0) {
    throw new Error("distanceKm must be a positive number");
  }

  const sql = `
    (
      6371 * acos(
        cos(radians((SELECT lat FROM venues.venues WHERE id = $1)))
        * cos(radians(u.lat))
        * cos(radians(u.lng) - radians((SELECT lng FROM venues.venues WHERE id = $1)))
        + sin(radians((SELECT lat FROM venues.venues WHERE id = $1)))
        * sin(radians(u.lat))
      )
    ) <= $2
  `.trim();

  return { sql, params: [filter.venueId, filter.distanceKm] };
}

/**
 * PostGIS variant — only usable when the `postgis` extension is installed.
 * Kept here for callers that can detect extension availability at deploy time.
 */
export function buildDistanceFromVenuePostgisClause(
  filter: GeoDistanceFilter,
): GeoWhereFragment {
  const sql = `
    ST_DWithin(
      u.geog,
      (SELECT geog FROM venues.venues WHERE id = $1),
      $2 * 1000
    )
  `.trim();

  return { sql, params: [filter.venueId, filter.distanceKm] };
}
