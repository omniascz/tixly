import type { ServiceDeps } from '../lib/service-container.js';
import { VenueError } from '../lib/venue-errors.js';
import { generateUniqueVenueSlug } from '../lib/slug.js';
import type { CreateVenueInput, UpdateVenueInput, VenuePublic, VenueWithOwnership } from '../types/venue.js';

// ---------------------------------------------------------------------------
// DB row type (snake_case from PostgreSQL)
// ---------------------------------------------------------------------------
interface VenueRow {
  id: string;
  name: string;
  slug: string | null;
  address: string;
  city: string;
  country: string;
  capacity: number;
  timezone: string;
  description: string | null;
  image_urls: string[];
  website: string | null;
  geo_lat: string | null; // NUMERIC comes back as string from pg
  geo_lng: string | null;
  is_public: boolean;
  owner_promoter_id: string | null;
  metadata: Record<string, unknown>;
  created_at: string;
  updated_at: string;
}

interface CountRow {
  count: string;
}

// ---------------------------------------------------------------------------
// Mapping helpers
// ---------------------------------------------------------------------------
function toPublic(row: VenueRow): VenuePublic {
  return {
    id: row.id,
    name: row.name,
    slug: row.slug,
    address: row.address,
    city: row.city,
    country: row.country,
    capacity: row.capacity,
    timezone: row.timezone,
    description: row.description,
    imageUrls: row.image_urls ?? [],
    website: row.website,
    geoLat: row.geo_lat !== null ? parseFloat(row.geo_lat) : null,
    geoLng: row.geo_lng !== null ? parseFloat(row.geo_lng) : null,
    isPublic: row.is_public,
    metadata: row.metadata ?? {},
  };
}

function toWithOwnership(row: VenueRow): VenueWithOwnership {
  return {
    ...toPublic(row),
    ownerPromoterId: row.owner_promoter_id,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

// ---------------------------------------------------------------------------
// Shared SQL helpers
// ---------------------------------------------------------------------------
const SELECT_PUBLIC_COLS = `
  id, name, slug, address, city, country, capacity, timezone,
  description, image_urls, website, geo_lat, geo_lng,
  is_public, metadata
`;

const SELECT_ALL_COLS = `
  id, name, slug, address, city, country, capacity, timezone,
  description, image_urls, website, geo_lat, geo_lng,
  is_public, owner_promoter_id, metadata, created_at, updated_at
`;

// ---------------------------------------------------------------------------
// Public queries
// ---------------------------------------------------------------------------

export async function listPublicVenues(
  filters: { city?: string; country?: string; minCapacity?: number; search?: string },
  pagination: { limit?: number; offset?: number },
  deps: ServiceDeps,
): Promise<{ items: VenuePublic[]; total: number }> {
  const { db } = deps;
  const limit = pagination.limit ?? 20;
  const offset = pagination.offset ?? 0;

  const conditions: string[] = ['is_public = TRUE'];
  const params: unknown[] = [];

  if (filters.city) {
    params.push(filters.city);
    conditions.push(`city = $${params.length}`);
  }
  if (filters.country) {
    params.push(filters.country);
    conditions.push(`country = $${params.length}`);
  }
  if (filters.minCapacity !== undefined) {
    params.push(filters.minCapacity);
    conditions.push(`capacity >= $${params.length}`);
  }
  if (filters.search) {
    // NFD-normalise on the JS side for the search pattern
    const pattern = `%${filters.search}%`;
    params.push(pattern);
    const idx = params.length;
    conditions.push(`(name ILIKE $${idx} OR city ILIKE $${idx})`);
  }

  const where = conditions.join(' AND ');

  const countRows = await db.query<CountRow>(
    `SELECT COUNT(*) AS count FROM catalog.venues WHERE ${where}`,
    params,
  );
  const total = parseInt(countRows[0]?.count ?? '0', 10);

  params.push(limit, offset);
  const rows = await db.query<VenueRow>(
    `SELECT ${SELECT_PUBLIC_COLS} FROM catalog.venues
     WHERE ${where}
     ORDER BY name ASC
     LIMIT $${params.length - 1} OFFSET $${params.length}`,
    params,
  );

  return { items: rows.map(toPublic), total };
}

export async function getPublicVenue(
  venueId: string,
  deps: ServiceDeps,
): Promise<VenuePublic> {
  const { db } = deps;
  const rows = await db.query<VenueRow>(
    `SELECT ${SELECT_PUBLIC_COLS} FROM catalog.venues
     WHERE id = $1 AND is_public = TRUE`,
    [venueId],
  );
  if (rows.length === 0) {
    throw new VenueError('VENUE_NOT_FOUND', 'Venue not found');
  }
  return toPublic(rows[0]);
}

// ---------------------------------------------------------------------------
// Promoter management
// ---------------------------------------------------------------------------

export async function listVenuesForPromoter(
  promoterId: string,
  filters: { search?: string },
  deps: ServiceDeps,
): Promise<VenueWithOwnership[]> {
  const { db } = deps;

  const conditions: string[] = ['(owner_promoter_id = $1 OR is_public = TRUE)'];
  const params: unknown[] = [promoterId];

  if (filters.search) {
    const pattern = `%${filters.search}%`;
    params.push(pattern);
    const idx = params.length;
    conditions.push(`(name ILIKE $${idx} OR city ILIKE $${idx})`);
  }

  const where = conditions.join(' AND ');

  const rows = await db.query<VenueRow>(
    `SELECT ${SELECT_ALL_COLS} FROM catalog.venues
     WHERE ${where}
     ORDER BY
       CASE WHEN owner_promoter_id = $1 THEN 0 ELSE 1 END ASC,
       name ASC`,
    params,
  );

  return rows.map(toWithOwnership);
}

export async function createVenue(
  promoterId: string,
  input: CreateVenueInput,
  deps: ServiceDeps,
): Promise<VenueWithOwnership> {
  const { db, kafka } = deps;

  if (input.capacity <= 0) {
    throw new VenueError('INVALID_CAPACITY', 'Capacity must be greater than 0');
  }

  const slug = await generateUniqueVenueSlug(input.name, db);

  const rows = await db.query<VenueRow>(
    `INSERT INTO catalog.venues (
      name, slug, address, city, country, capacity, timezone,
      description, image_urls, website, geo_lat, geo_lng,
      is_public, owner_promoter_id, metadata
    ) VALUES (
      $1, $2, $3, $4, $5, $6, $7,
      $8, $9, $10, $11, $12,
      $13, $14, $15
    )
    RETURNING ${SELECT_ALL_COLS}`,
    [
      input.name,
      slug,
      input.address,
      input.city,
      input.country ?? 'CZ',
      input.capacity,
      input.timezone ?? 'Europe/Prague',
      input.description ?? null,
      input.imageUrls ?? [],
      input.website ?? null,
      input.geoLat ?? null,
      input.geoLng ?? null,
      input.isPublic ?? false,
      promoterId,
      JSON.stringify(input.metadata ?? {}),
    ],
  );

  const venue = toWithOwnership(rows[0]);

  kafka
    .send('venue.created', { venueId: venue.id, promoterId, slug: venue.slug })
    .catch(() => {/* fire-and-forget */});

  return venue;
}

export async function updateVenue(
  venueId: string,
  promoterId: string,
  input: UpdateVenueInput,
  deps: ServiceDeps,
): Promise<VenueWithOwnership> {
  const { db } = deps;

  const existing = await db.query<VenueRow>(
    `SELECT ${SELECT_ALL_COLS} FROM catalog.venues WHERE id = $1`,
    [venueId],
  );

  if (existing.length === 0 || existing[0].owner_promoter_id !== promoterId) {
    throw new VenueError('VENUE_ACCESS_DENIED', 'Venue not found or access denied');
  }

  if (existing[0].is_public) {
    throw new VenueError('VENUE_NOT_EDITABLE', 'Public venues can only be edited by platform admins');
  }

  const current = existing[0];

  // Handle slug change
  let newSlug = current.slug;
  if (input.name !== undefined && input.name !== current.name) {
    newSlug = await generateUniqueVenueSlug(input.name, db);
  }

  const rows = await db.query<VenueRow>(
    `UPDATE catalog.venues SET
      name         = $1,
      slug         = $2,
      address      = $3,
      city         = $4,
      country      = $5,
      capacity     = $6,
      timezone     = $7,
      description  = $8,
      image_urls   = $9,
      website      = $10,
      geo_lat      = $11,
      geo_lng      = $12,
      is_public    = $13,
      metadata     = $14,
      updated_at   = NOW()
    WHERE id = $15
    RETURNING ${SELECT_ALL_COLS}`,
    [
      input.name ?? current.name,
      newSlug,
      input.address ?? current.address,
      input.city ?? current.city,
      input.country ?? current.country,
      input.capacity ?? current.capacity,
      input.timezone ?? current.timezone,
      input.description !== undefined ? input.description : current.description,
      input.imageUrls ?? current.image_urls,
      input.website !== undefined ? input.website : current.website,
      input.geoLat !== undefined ? input.geoLat : current.geo_lat,
      input.geoLng !== undefined ? input.geoLng : current.geo_lng,
      input.isPublic !== undefined ? input.isPublic : current.is_public,
      JSON.stringify(input.metadata !== undefined ? input.metadata : current.metadata),
      venueId,
    ],
  );

  return toWithOwnership(rows[0]);
}

export async function deleteVenue(
  venueId: string,
  promoterId: string,
  deps: ServiceDeps,
): Promise<void> {
  const { db, kafka } = deps;

  const existing = await db.query<VenueRow>(
    `SELECT ${SELECT_ALL_COLS} FROM catalog.venues WHERE id = $1`,
    [venueId],
  );

  if (existing.length === 0 || existing[0].owner_promoter_id !== promoterId) {
    throw new VenueError('VENUE_ACCESS_DENIED', 'Venue not found or access denied');
  }

  const futureEvents = await db.query<CountRow>(
    `SELECT COUNT(*) AS count FROM catalog.events
     WHERE venue_id = $1 AND date > NOW()`,
    [venueId],
  );

  if (parseInt(futureEvents[0]?.count ?? '0', 10) > 0) {
    throw new VenueError('VENUE_HAS_EVENTS', 'Venue has upcoming events and cannot be deleted');
  }

  await db.execute(
    `DELETE FROM catalog.venues WHERE id = $1`,
    [venueId],
  );

  kafka
    .send('venue.deleted', { venueId, promoterId })
    .catch(() => {/* fire-and-forget */});
}

export async function makeVenuePublic(
  venueId: string,
  promoterId: string,
  deps: ServiceDeps,
): Promise<VenueWithOwnership> {
  const { db, kafka } = deps;

  const existing = await db.query<VenueRow>(
    `SELECT ${SELECT_ALL_COLS} FROM catalog.venues WHERE id = $1`,
    [venueId],
  );

  if (existing.length === 0 || existing[0].owner_promoter_id !== promoterId) {
    throw new VenueError('VENUE_ACCESS_DENIED', 'Venue not found or access denied');
  }

  const rows = await db.query<VenueRow>(
    `UPDATE catalog.venues SET is_public = TRUE, updated_at = NOW()
     WHERE id = $1
     RETURNING ${SELECT_ALL_COLS}`,
    [venueId],
  );

  const venue = toWithOwnership(rows[0]);

  kafka
    .send('venue.made_public', { venueId, promoterId })
    .catch(() => {/* fire-and-forget */});

  return venue;
}

export async function makeVenuePrivate(
  venueId: string,
  promoterId: string,
  deps: ServiceDeps,
): Promise<VenueWithOwnership> {
  const { db, kafka } = deps;

  const existing = await db.query<VenueRow>(
    `SELECT ${SELECT_ALL_COLS} FROM catalog.venues WHERE id = $1`,
    [venueId],
  );

  if (existing.length === 0 || existing[0].owner_promoter_id !== promoterId) {
    throw new VenueError('VENUE_ACCESS_DENIED', 'Venue not found or access denied');
  }

  const otherEvents = await db.query<CountRow>(
    `SELECT COUNT(*) AS count FROM catalog.events
     WHERE venue_id = $1 AND organizer_id != $2 AND date > NOW()`,
    [venueId, promoterId],
  );

  const affectedCount = parseInt(otherEvents[0]?.count ?? '0', 10);
  if (affectedCount > 0) {
    throw new VenueError(
      'VENUE_HAS_EVENTS',
      `Cannot make venue private: ${affectedCount} upcoming event(s) from other promoters`,
      { affectedEventCount: affectedCount },
    );
  }

  const rows = await db.query<VenueRow>(
    `UPDATE catalog.venues SET is_public = FALSE, updated_at = NOW()
     WHERE id = $1
     RETURNING ${SELECT_ALL_COLS}`,
    [venueId],
  );

  const venue = toWithOwnership(rows[0]);

  kafka
    .send('venue.made_private', { venueId, promoterId })
    .catch(() => {/* fire-and-forget */});

  return venue;
}

// ---------------------------------------------------------------------------
// Admin management
// ---------------------------------------------------------------------------

export async function adminListVenues(
  filters: { ownerPromoterId?: string; isPublic?: boolean; search?: string },
  pagination: { limit?: number; offset?: number },
  deps: ServiceDeps,
): Promise<{ items: VenueWithOwnership[]; total: number }> {
  const { db } = deps;
  const limit = pagination.limit ?? 20;
  const offset = pagination.offset ?? 0;

  const conditions: string[] = ['1 = 1'];
  const params: unknown[] = [];

  if (filters.ownerPromoterId !== undefined) {
    params.push(filters.ownerPromoterId);
    conditions.push(`owner_promoter_id = $${params.length}`);
  }
  if (filters.isPublic !== undefined) {
    params.push(filters.isPublic);
    conditions.push(`is_public = $${params.length}`);
  }
  if (filters.search) {
    const pattern = `%${filters.search}%`;
    params.push(pattern);
    const idx = params.length;
    conditions.push(`(name ILIKE $${idx} OR city ILIKE $${idx})`);
  }

  const where = conditions.join(' AND ');

  const countRows = await db.query<CountRow>(
    `SELECT COUNT(*) AS count FROM catalog.venues WHERE ${where}`,
    params,
  );
  const total = parseInt(countRows[0]?.count ?? '0', 10);

  params.push(limit, offset);
  const rows = await db.query<VenueRow>(
    `SELECT ${SELECT_ALL_COLS} FROM catalog.venues
     WHERE ${where}
     ORDER BY name ASC
     LIMIT $${params.length - 1} OFFSET $${params.length}`,
    params,
  );

  return { items: rows.map(toWithOwnership), total };
}

export async function adminCreatePublicVenue(
  input: CreateVenueInput,
  adminUserId: string,
  deps: ServiceDeps,
): Promise<VenueWithOwnership> {
  const { db, kafka } = deps;

  if (input.capacity <= 0) {
    throw new VenueError('INVALID_CAPACITY', 'Capacity must be greater than 0');
  }

  const slug = await generateUniqueVenueSlug(input.name, db);

  const rows = await db.query<VenueRow>(
    `INSERT INTO catalog.venues (
      name, slug, address, city, country, capacity, timezone,
      description, image_urls, website, geo_lat, geo_lng,
      is_public, owner_promoter_id, metadata
    ) VALUES (
      $1, $2, $3, $4, $5, $6, $7,
      $8, $9, $10, $11, $12,
      TRUE, NULL, $13
    )
    RETURNING ${SELECT_ALL_COLS}`,
    [
      input.name,
      slug,
      input.address,
      input.city,
      input.country ?? 'CZ',
      input.capacity,
      input.timezone ?? 'Europe/Prague',
      input.description ?? null,
      input.imageUrls ?? [],
      input.website ?? null,
      input.geoLat ?? null,
      input.geoLng ?? null,
      JSON.stringify(input.metadata ?? {}),
    ],
  );

  const venue = toWithOwnership(rows[0]);

  kafka
    .send('venue.created', { venueId: venue.id, adminUserId, isPublic: true, slug: venue.slug })
    .catch(() => {/* fire-and-forget */});

  return venue;
}

export async function adminUpdateVenue(
  venueId: string,
  input: UpdateVenueInput,
  adminUserId: string,
  deps: ServiceDeps,
): Promise<VenueWithOwnership> {
  const { db } = deps;

  const existing = await db.query<VenueRow>(
    `SELECT ${SELECT_ALL_COLS} FROM catalog.venues WHERE id = $1`,
    [venueId],
  );

  if (existing.length === 0) {
    throw new VenueError('VENUE_NOT_FOUND', 'Venue not found');
  }

  const current = existing[0];

  let newSlug = current.slug;
  if (input.name !== undefined && input.name !== current.name) {
    newSlug = await generateUniqueVenueSlug(input.name, db);
  }

  const rows = await db.query<VenueRow>(
    `UPDATE catalog.venues SET
      name         = $1,
      slug         = $2,
      address      = $3,
      city         = $4,
      country      = $5,
      capacity     = $6,
      timezone     = $7,
      description  = $8,
      image_urls   = $9,
      website      = $10,
      geo_lat      = $11,
      geo_lng      = $12,
      is_public    = $13,
      metadata     = $14,
      updated_at   = NOW()
    WHERE id = $15
    RETURNING ${SELECT_ALL_COLS}`,
    [
      input.name ?? current.name,
      newSlug,
      input.address ?? current.address,
      input.city ?? current.city,
      input.country ?? current.country,
      input.capacity ?? current.capacity,
      input.timezone ?? current.timezone,
      input.description !== undefined ? input.description : current.description,
      input.imageUrls ?? current.image_urls,
      input.website !== undefined ? input.website : current.website,
      input.geoLat !== undefined ? input.geoLat : current.geo_lat,
      input.geoLng !== undefined ? input.geoLng : current.geo_lng,
      input.isPublic !== undefined ? input.isPublic : current.is_public,
      JSON.stringify(input.metadata !== undefined ? input.metadata : current.metadata),
      venueId,
    ],
  );

  return toWithOwnership(rows[0]);
}

export async function adminTransferVenue(
  venueId: string,
  newOwnerPromoterId: string,
  adminUserId: string,
  deps: ServiceDeps,
): Promise<VenueWithOwnership> {
  const { db, kafka } = deps;

  const existing = await db.query<VenueRow>(
    `SELECT ${SELECT_ALL_COLS} FROM catalog.venues WHERE id = $1`,
    [venueId],
  );

  if (existing.length === 0) {
    throw new VenueError('VENUE_NOT_FOUND', 'Venue not found');
  }

  const previousOwner = existing[0].owner_promoter_id;

  const rows = await db.query<VenueRow>(
    `UPDATE catalog.venues
     SET owner_promoter_id = $1, updated_at = NOW()
     WHERE id = $2
     RETURNING ${SELECT_ALL_COLS}`,
    [newOwnerPromoterId, venueId],
  );

  const venue = toWithOwnership(rows[0]);

  kafka
    .send('venue.ownership_transferred', {
      venueId,
      previousOwnerPromoterId: previousOwner,
      newOwnerPromoterId,
      adminUserId,
    })
    .catch(() => {/* fire-and-forget */});

  return venue;
}
