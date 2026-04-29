import { CinemaError } from '../lib/cinema-errors';

// ---------------------------------------------------------------------------
// DB adapter
// ---------------------------------------------------------------------------

export interface CinemaDB {
  query<T>(sql: string, params?: unknown[]): Promise<{ rows: T[] }>;
  execute(sql: string, params?: unknown[]): Promise<void>;
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface VenueInput {
  name: string;
  address?: string;
  city?: string;
  timezone?: string;
  websiteUrl?: string;
}

export interface AuditoriumInput {
  name: string;
  capacity: number;
  has3d?: boolean;
  hasImax?: boolean;
  hasDolby?: boolean;
  seatingMapUrl?: string;
}

export interface Venue {
  id: string;
  promoterId: string;
  name: string;
  address: string | null;
  city: string | null;
  timezone: string;
  websiteUrl: string | null;
  createdAt: string;
  auditoriumCount?: number;
}

export interface Auditorium {
  id: string;
  venueId: string;
  name: string;
  capacity: number;
  has3d: boolean;
  hasImax: boolean;
  hasDolby: boolean;
  seatingMapUrl: string | null;
  createdAt: string;
  venueName?: string;
}

// ---------------------------------------------------------------------------
// Venue functions
// ---------------------------------------------------------------------------

export async function createVenue(
  promoterId: string,
  input: VenueInput,
  db: CinemaDB,
): Promise<Venue> {
  const { rows } = await db.query<{
    id: string; promoter_id: string; name: string; address: string | null;
    city: string | null; timezone: string; website_url: string | null; created_at: string;
  }>(
    `INSERT INTO cinema.venues (promoter_id, name, address, city, timezone, website_url)
     VALUES ($1, $2, $3, $4, $5, $6)
     RETURNING *`,
    [
      promoterId,
      input.name,
      input.address ?? null,
      input.city ?? null,
      input.timezone ?? 'Europe/Prague',
      input.websiteUrl ?? null,
    ],
  );

  if (!rows[0]) {
    throw new CinemaError('VENUE_DUPLICATE');
  }

  return mapVenue(rows[0]);
}

export async function getVenue(venueId: string, db: CinemaDB): Promise<Venue> {
  const { rows } = await db.query<{
    id: string; promoter_id: string; name: string; address: string | null;
    city: string | null; timezone: string; website_url: string | null;
    created_at: string; auditorium_count: string;
  }>(
    `SELECT v.*, COUNT(a.id) AS auditorium_count
     FROM cinema.venues v
     LEFT JOIN cinema.auditoriums a ON a.venue_id = v.id
     WHERE v.id = $1
     GROUP BY v.id`,
    [venueId],
  );

  if (!rows[0]) {
    throw new CinemaError('VENUE_NOT_FOUND');
  }

  return {
    ...mapVenue(rows[0]),
    auditoriumCount: parseInt(rows[0].auditorium_count ?? '0', 10),
  };
}

export async function listVenues(promoterId: string, db: CinemaDB): Promise<Venue[]> {
  const { rows } = await db.query<{
    id: string; promoter_id: string; name: string; address: string | null;
    city: string | null; timezone: string; website_url: string | null; created_at: string;
  }>(
    `SELECT * FROM cinema.venues WHERE promoter_id = $1 ORDER BY name ASC`,
    [promoterId],
  );

  return rows.map(mapVenue);
}

// ---------------------------------------------------------------------------
// Auditorium functions
// ---------------------------------------------------------------------------

export async function createAuditorium(
  venueId: string,
  input: AuditoriumInput,
  db: CinemaDB,
): Promise<Auditorium> {
  const { rows } = await db.query<{
    id: string; venue_id: string; name: string; capacity: number;
    has_3d: boolean; has_imax: boolean; has_dolby: boolean;
    seating_map_url: string | null; created_at: string;
  }>(
    `INSERT INTO cinema.auditoriums (venue_id, name, capacity, has_3d, has_imax, has_dolby, seating_map_url)
     VALUES ($1, $2, $3, $4, $5, $6, $7)
     RETURNING *`,
    [
      venueId,
      input.name,
      input.capacity,
      input.has3d ?? false,
      input.hasImax ?? false,
      input.hasDolby ?? false,
      input.seatingMapUrl ?? null,
    ],
  );

  if (!rows[0]) {
    throw new CinemaError('AUDITORIUM_DUPLICATE');
  }

  return mapAuditorium(rows[0]);
}

export async function getAuditorium(auditoriumId: string, db: CinemaDB): Promise<Auditorium> {
  const { rows } = await db.query<{
    id: string; venue_id: string; name: string; capacity: number;
    has_3d: boolean; has_imax: boolean; has_dolby: boolean;
    seating_map_url: string | null; created_at: string; venue_name: string;
  }>(
    `SELECT a.*, v.name AS venue_name
     FROM cinema.auditoriums a
     JOIN cinema.venues v ON v.id = a.venue_id
     WHERE a.id = $1`,
    [auditoriumId],
  );

  if (!rows[0]) {
    throw new CinemaError('AUDITORIUM_NOT_FOUND');
  }

  return {
    ...mapAuditorium(rows[0]),
    venueName: rows[0].venue_name,
  };
}

export async function listAuditoriums(venueId: string, db: CinemaDB): Promise<Auditorium[]> {
  const { rows } = await db.query<{
    id: string; venue_id: string; name: string; capacity: number;
    has_3d: boolean; has_imax: boolean; has_dolby: boolean;
    seating_map_url: string | null; created_at: string;
  }>(
    `SELECT * FROM cinema.auditoriums WHERE venue_id = $1 ORDER BY name ASC`,
    [venueId],
  );

  return rows.map(mapAuditorium);
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function mapVenue(row: {
  id: string; promoter_id: string; name: string; address: string | null;
  city: string | null; timezone: string; website_url: string | null; created_at: string;
}): Venue {
  return {
    id: row.id,
    promoterId: row.promoter_id,
    name: row.name,
    address: row.address,
    city: row.city,
    timezone: row.timezone,
    websiteUrl: row.website_url,
    createdAt: row.created_at,
  };
}

function mapAuditorium(row: {
  id: string; venue_id: string; name: string; capacity: number;
  has_3d: boolean; has_imax: boolean; has_dolby: boolean;
  seating_map_url: string | null; created_at: string;
}): Auditorium {
  return {
    id: row.id,
    venueId: row.venue_id,
    name: row.name,
    capacity: row.capacity,
    has3d: row.has_3d,
    hasImax: row.has_imax,
    hasDolby: row.has_dolby,
    seatingMapUrl: row.seating_map_url,
    createdAt: row.created_at,
  };
}
