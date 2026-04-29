import { EntryError } from '../lib/entry-errors';

// ---------------------------------------------------------------------------
// DB adapter
// ---------------------------------------------------------------------------

export interface EntryDB {
  query<T = Record<string, unknown>>(sql: string, params?: unknown[]): Promise<{ rows: T[] }>;
  execute(sql: string, params?: unknown[]): Promise<void>;
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type VenueType =
  | 'museum'
  | 'gallery'
  | 'zoo'
  | 'botanical_garden'
  | 'national_park'
  | 'historic_site'
  | 'aquarium'
  | 'planetarium';

export interface CulturalVenue {
  id: string;
  promoterId: string;
  name: string;
  venueType: VenueType;
  address: string | null;
  city: string | null;
  description: string | null;
  websiteUrl: string | null;
  googleMapsUrl: string | null;
  accessibilityInfo: string | null;
  isActive: boolean;
  createdAt: string;
  zoneCount?: number;
  ticketTypeCount?: number;
}

export interface CreateVenueInput {
  name: string;
  venueType: VenueType;
  address?: string;
  city?: string;
  description?: string;
  websiteUrl?: string;
  googleMapsUrl?: string;
  accessibilityInfo?: string;
}

export interface VenueZone {
  id: string;
  venueId: string;
  name: string;
  description: string | null;
  capacity: number;
  requiresSeparateTicket: boolean;
  additionalPriceHellers: number;
  sortOrder: number;
  isActive: boolean;
}

export interface CreateZoneInput {
  name: string;
  description?: string;
  capacity: number;
  requiresSeparateTicket?: boolean;
  additionalPriceHellers?: number;
  sortOrder?: number;
}

export interface VenueTicketType {
  id: string;
  venueId: string;
  name: string;
  priceHellers: number;
  ageMin: number;
  ageMax: number;
  maxPerBooking: number;
  requiresId: boolean;
  description: string | null;
  isActive: boolean;
  sortOrder: number;
}

export interface CreateTicketTypeInput {
  name: string;
  priceHellers: number;
  ageMin?: number;
  ageMax?: number;
  maxPerBooking?: number;
  requiresId?: boolean;
  description?: string;
  sortOrder?: number;
}

export interface ListVenuesFilters {
  venueType?: VenueType;
  city?: string;
}

// ---------------------------------------------------------------------------
// Row mappers
// ---------------------------------------------------------------------------

function rowToVenue(row: Record<string, unknown>): CulturalVenue {
  return {
    id: row.id as string,
    promoterId: row.promoter_id as string,
    name: row.name as string,
    venueType: row.venue_type as VenueType,
    address: (row.address as string | null) ?? null,
    city: (row.city as string | null) ?? null,
    description: (row.description as string | null) ?? null,
    websiteUrl: (row.website_url as string | null) ?? null,
    googleMapsUrl: (row.google_maps_url as string | null) ?? null,
    accessibilityInfo: (row.accessibility_info as string | null) ?? null,
    isActive: row.is_active as boolean,
    createdAt: row.created_at as string,
    zoneCount: row.zone_count !== undefined ? Number(row.zone_count) : undefined,
    ticketTypeCount: row.ticket_type_count !== undefined ? Number(row.ticket_type_count) : undefined,
  };
}

function rowToZone(row: Record<string, unknown>): VenueZone {
  return {
    id: row.id as string,
    venueId: row.venue_id as string,
    name: row.name as string,
    description: (row.description as string | null) ?? null,
    capacity: row.capacity as number,
    requiresSeparateTicket: row.requires_separate_ticket as boolean,
    additionalPriceHellers: row.additional_price_hellers as number,
    sortOrder: row.sort_order as number,
    isActive: row.is_active as boolean,
  };
}

function rowToTicketType(row: Record<string, unknown>): VenueTicketType {
  return {
    id: row.id as string,
    venueId: row.venue_id as string,
    name: row.name as string,
    priceHellers: row.price_hellers as number,
    ageMin: row.age_min as number,
    ageMax: row.age_max as number,
    maxPerBooking: row.max_per_booking as number,
    requiresId: row.requires_id as boolean,
    description: (row.description as string | null) ?? null,
    isActive: row.is_active as boolean,
    sortOrder: row.sort_order as number,
  };
}

// ---------------------------------------------------------------------------
// createVenue
// ---------------------------------------------------------------------------

export async function createVenue(
  promoterId: string,
  input: CreateVenueInput,
  db: EntryDB,
): Promise<CulturalVenue> {
  const { rows } = await db.query<Record<string, unknown>>(
    `INSERT INTO venues.cultural_venues
       (promoter_id, name, venue_type, address, city, description,
        website_url, google_maps_url, accessibility_info)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
     RETURNING *`,
    [
      promoterId,
      input.name,
      input.venueType,
      input.address ?? null,
      input.city ?? null,
      input.description ?? null,
      input.websiteUrl ?? null,
      input.googleMapsUrl ?? null,
      input.accessibilityInfo ?? null,
    ],
  );

  if (!rows[0]) {
    throw new EntryError('VENUE_DUPLICATE');
  }

  return rowToVenue(rows[0]);
}

// ---------------------------------------------------------------------------
// getVenue
// ---------------------------------------------------------------------------

export async function getVenue(venueId: string, db: EntryDB): Promise<CulturalVenue> {
  const { rows } = await db.query<Record<string, unknown>>(
    `SELECT v.*,
       (SELECT COUNT(*) FROM venues.venue_zones z WHERE z.venue_id = v.id AND z.is_active = true) AS zone_count,
       (SELECT COUNT(*) FROM venues.ticket_types t WHERE t.venue_id = v.id AND t.is_active = true) AS ticket_type_count
     FROM venues.cultural_venues v
     WHERE v.id = $1`,
    [venueId],
  );

  if (!rows[0]) {
    throw new EntryError('VENUE_NOT_FOUND');
  }

  return rowToVenue(rows[0]);
}

// ---------------------------------------------------------------------------
// listVenues
// ---------------------------------------------------------------------------

export async function listVenues(
  promoterId: string,
  filters: ListVenuesFilters,
  db: EntryDB,
): Promise<CulturalVenue[]> {
  const conditions: string[] = ['v.promoter_id = $1', 'v.is_active = true'];
  const params: unknown[] = [promoterId];
  let idx = 2;

  if (filters.venueType) {
    conditions.push(`v.venue_type = $${idx}`);
    params.push(filters.venueType);
    idx++;
  }

  if (filters.city) {
    conditions.push(`v.city = $${idx}`);
    params.push(filters.city);
    idx++;
  }

  const where = conditions.join(' AND ');

  const { rows } = await db.query<Record<string, unknown>>(
    `SELECT v.* FROM venues.cultural_venues v WHERE ${where} ORDER BY v.name`,
    params,
  );

  return rows.map(rowToVenue);
}

// ---------------------------------------------------------------------------
// updateVenue
// ---------------------------------------------------------------------------

export async function updateVenue(
  venueId: string,
  input: Partial<CreateVenueInput>,
  db: EntryDB,
): Promise<CulturalVenue> {
  const sets: string[] = [];
  const params: unknown[] = [];
  let idx = 1;

  if (input.name !== undefined) { sets.push(`name = $${idx}`); params.push(input.name); idx++; }
  if (input.venueType !== undefined) { sets.push(`venue_type = $${idx}`); params.push(input.venueType); idx++; }
  if (input.address !== undefined) { sets.push(`address = $${idx}`); params.push(input.address); idx++; }
  if (input.city !== undefined) { sets.push(`city = $${idx}`); params.push(input.city); idx++; }
  if (input.description !== undefined) { sets.push(`description = $${idx}`); params.push(input.description); idx++; }
  if (input.websiteUrl !== undefined) { sets.push(`website_url = $${idx}`); params.push(input.websiteUrl); idx++; }
  if (input.googleMapsUrl !== undefined) { sets.push(`google_maps_url = $${idx}`); params.push(input.googleMapsUrl); idx++; }
  if (input.accessibilityInfo !== undefined) { sets.push(`accessibility_info = $${idx}`); params.push(input.accessibilityInfo); idx++; }

  params.push(venueId);

  const { rows } = await db.query<Record<string, unknown>>(
    `UPDATE venues.cultural_venues SET ${sets.join(', ')} WHERE id = $${idx} RETURNING *`,
    params,
  );

  if (!rows[0]) {
    throw new EntryError('VENUE_NOT_FOUND');
  }

  return rowToVenue(rows[0]);
}

// ---------------------------------------------------------------------------
// createZone
// ---------------------------------------------------------------------------

export async function createZone(
  venueId: string,
  input: CreateZoneInput,
  db: EntryDB,
): Promise<VenueZone> {
  const { rows } = await db.query<Record<string, unknown>>(
    `INSERT INTO venues.venue_zones
       (venue_id, name, description, capacity, requires_separate_ticket, additional_price_hellers, sort_order)
     VALUES ($1,$2,$3,$4,$5,$6,$7)
     RETURNING *`,
    [
      venueId,
      input.name,
      input.description ?? null,
      input.capacity,
      input.requiresSeparateTicket ?? false,
      input.additionalPriceHellers ?? 0,
      input.sortOrder ?? 0,
    ],
  );

  if (!rows[0]) {
    throw new EntryError('ZONE_DUPLICATE');
  }

  return rowToZone(rows[0]);
}

// ---------------------------------------------------------------------------
// listZones
// ---------------------------------------------------------------------------

export async function listZones(venueId: string, db: EntryDB): Promise<VenueZone[]> {
  const { rows } = await db.query<Record<string, unknown>>(
    `SELECT * FROM venues.venue_zones WHERE venue_id = $1 AND is_active = true ORDER BY sort_order`,
    [venueId],
  );

  return rows.map(rowToZone);
}

// ---------------------------------------------------------------------------
// createTicketType
// ---------------------------------------------------------------------------

export async function createTicketType(
  venueId: string,
  input: CreateTicketTypeInput,
  db: EntryDB,
): Promise<VenueTicketType> {
  const { rows } = await db.query<Record<string, unknown>>(
    `INSERT INTO venues.ticket_types
       (venue_id, name, price_hellers, age_min, age_max, max_per_booking, requires_id, description, sort_order)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
     RETURNING *`,
    [
      venueId,
      input.name,
      input.priceHellers,
      input.ageMin ?? 0,
      input.ageMax ?? 999,
      input.maxPerBooking ?? 10,
      input.requiresId ?? false,
      input.description ?? null,
      input.sortOrder ?? 0,
    ],
  );

  if (!rows[0]) {
    throw new EntryError('VENUE_NOT_FOUND');
  }

  return rowToTicketType(rows[0]);
}

// ---------------------------------------------------------------------------
// listTicketTypes
// ---------------------------------------------------------------------------

export async function listTicketTypes(venueId: string, db: EntryDB): Promise<VenueTicketType[]> {
  const { rows } = await db.query<Record<string, unknown>>(
    `SELECT * FROM venues.ticket_types WHERE venue_id = $1 AND is_active = true ORDER BY sort_order`,
    [venueId],
  );

  return rows.map(rowToTicketType);
}
