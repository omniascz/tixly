import { CatalogError } from '../lib/catalog-errors';
import type { CatalogDB } from './category.service';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type PriceType = 'fixed' | 'per_person' | 'per_hour' | 'free';

export interface ServiceInput {
  name: string;
  slug?: string;
  branchId?: string | null;
  categoryId?: string | null;
  shortDescription?: string | null;
  description?: string | null;
  durationMinutes: number;
  capacityMin?: number;
  capacityMax?: number;
  priceHellers?: number;
  priceType?: PriceType;
  requiresResource?: boolean;
  resourceType?: string | null;
  cancellationHours?: number;
  bookingWindowDays?: number;
  minAdvanceHours?: number;
  images?: string[];
  tags?: string[];
  metadata?: Record<string, unknown>;
  isActive?: boolean;
  isFeatured?: boolean;
}

export interface ServiceFilters {
  categoryId?: string;
  branchId?: string;
  isActive?: boolean;
  isFeatured?: boolean;
  tags?: string[];
  resourceType?: string;
}

export interface ServiceAddon {
  id: string;
  serviceId: string;
  name: string;
  description: string | null;
  priceHellers: number;
  maxQuantity: number;
  isRequired: boolean;
  isActive: boolean;
  sortOrder: number;
}

export interface BookableService {
  id: string;
  promoterId: string;
  branchId: string | null;
  categoryId: string | null;
  categoryName: string | null;
  name: string;
  slug: string;
  shortDescription: string | null;
  description: string | null;
  durationMinutes: number;
  capacityMin: number;
  capacityMax: number;
  priceHellers: number;
  priceType: PriceType;
  requiresResource: boolean;
  resourceType: string | null;
  cancellationHours: number;
  bookingWindowDays: number;
  minAdvanceHours: number;
  images: string[];
  tags: string[];
  metadata: Record<string, unknown>;
  isActive: boolean;
  isFeatured: boolean;
  createdAt: string;
  updatedAt: string;
  addons?: ServiceAddon[];
  avgRating?: number | null;
  reviewCount?: number;
}

export interface ServiceResource {
  serviceId: string;
  resourceId: string;
  isPrimary: boolean;
}

// ---------------------------------------------------------------------------
// Row types
// ---------------------------------------------------------------------------

interface ServiceRow {
  id: string;
  promoter_id: string;
  branch_id: string | null;
  category_id: string | null;
  category_name: string | null;
  name: string;
  slug: string;
  short_description: string | null;
  description: string | null;
  duration_minutes: number;
  capacity_min: number;
  capacity_max: number;
  price_hellers: number;
  price_type: PriceType;
  requires_resource: boolean;
  resource_type: string | null;
  cancellation_hours: number;
  booking_window_days: number;
  min_advance_hours: number;
  images: string[];
  tags: string[];
  metadata: Record<string, unknown>;
  is_active: boolean;
  is_featured: boolean;
  created_at: string;
  updated_at: string;
  avg_rating?: string | number | null;
  review_count?: string | number;
}

interface AddonRow {
  id: string;
  service_id: string;
  name: string;
  description: string | null;
  price_hellers: number;
  max_quantity: number;
  is_required: boolean;
  is_active: boolean;
  sort_order: number;
}

interface ResourceLinkRow {
  service_id: string;
  resource_id: string;
  is_primary: boolean;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function slugify(name: string): string {
  return name
    .toLowerCase()
    .replace(/\s+/g, '-')
    .replace(/[^a-z0-9-]/g, '')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
}

function mapService(row: ServiceRow): BookableService {
  return {
    id: row.id,
    promoterId: row.promoter_id,
    branchId: row.branch_id,
    categoryId: row.category_id,
    categoryName: row.category_name,
    name: row.name,
    slug: row.slug,
    shortDescription: row.short_description,
    description: row.description,
    durationMinutes: row.duration_minutes,
    capacityMin: row.capacity_min,
    capacityMax: row.capacity_max,
    priceHellers: row.price_hellers,
    priceType: row.price_type,
    requiresResource: row.requires_resource,
    resourceType: row.resource_type,
    cancellationHours: row.cancellation_hours,
    bookingWindowDays: row.booking_window_days,
    minAdvanceHours: row.min_advance_hours,
    images: row.images ?? [],
    tags: row.tags ?? [],
    metadata: row.metadata ?? {},
    isActive: row.is_active,
    isFeatured: row.is_featured,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    avgRating: row.avg_rating !== undefined && row.avg_rating !== null ? Number(row.avg_rating) : null,
    reviewCount: row.review_count !== undefined ? Number(row.review_count) : 0,
  };
}

function mapAddon(row: AddonRow): ServiceAddon {
  return {
    id: row.id,
    serviceId: row.service_id,
    name: row.name,
    description: row.description,
    priceHellers: row.price_hellers,
    maxQuantity: row.max_quantity,
    isRequired: row.is_required,
    isActive: row.is_active,
    sortOrder: row.sort_order,
  };
}

// ---------------------------------------------------------------------------
// Functions
// ---------------------------------------------------------------------------

export async function createService(
  promoterId: string,
  input: ServiceInput,
  db: CatalogDB,
): Promise<BookableService> {
  const slug = input.slug ?? slugify(input.name);

  const { rows } = await db.query<ServiceRow>(
    `INSERT INTO reservations.services
       (promoter_id, branch_id, category_id, name, slug, short_description,
        description, duration_minutes, capacity_min, capacity_max, price_hellers,
        price_type, requires_resource, resource_type, cancellation_hours,
        booking_window_days, min_advance_hours, images, tags, metadata,
        is_active, is_featured)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22)
     RETURNING *, NULL AS category_name, NULL AS avg_rating, 0 AS review_count`,
    [
      promoterId,
      input.branchId ?? null,
      input.categoryId ?? null,
      input.name,
      slug,
      input.shortDescription ?? null,
      input.description ?? null,
      input.durationMinutes,
      input.capacityMin ?? 1,
      input.capacityMax ?? 1,
      input.priceHellers ?? 0,
      input.priceType ?? 'fixed',
      input.requiresResource ?? true,
      input.resourceType ?? null,
      input.cancellationHours ?? 24,
      input.bookingWindowDays ?? 30,
      input.minAdvanceHours ?? 1,
      input.images ?? [],
      input.tags ?? [],
      JSON.stringify(input.metadata ?? {}),
      input.isActive ?? true,
      input.isFeatured ?? false,
    ],
  );

  if (!rows[0]) {
    throw new CatalogError('SERVICE_DUPLICATE');
  }

  return mapService(rows[0]);
}

export async function getService(
  serviceId: string,
  db: CatalogDB,
): Promise<BookableService> {
  // Query 1: service with category name + avg_rating
  const { rows } = await db.query<ServiceRow>(
    `SELECT s.*,
            sc.name AS category_name,
            AVG(r.rating)::numeric(3,2) AS avg_rating,
            COUNT(r.id) AS review_count
     FROM reservations.services s
     LEFT JOIN reservations.service_categories sc ON sc.id = s.category_id
     LEFT JOIN reservations.service_reviews r ON r.service_id = s.id
     WHERE s.id = $1
     GROUP BY s.id, sc.name`,
    [serviceId],
  );

  if (!rows[0]) {
    throw new CatalogError('SERVICE_NOT_FOUND');
  }

  const service = mapService(rows[0]);

  // Query 2: addons
  const { rows: addonRows } = await db.query<AddonRow>(
    `SELECT * FROM reservations.service_addons
     WHERE service_id = $1 AND is_active = true
     ORDER BY sort_order ASC`,
    [serviceId],
  );

  service.addons = addonRows.map(mapAddon);

  return service;
}

export async function listServices(
  promoterId: string,
  filters: ServiceFilters,
  db: CatalogDB,
): Promise<BookableService[]> {
  const conditions: string[] = ['s.promoter_id = $1'];
  const params: unknown[] = [promoterId];
  let idx = 2;

  if (filters.categoryId !== undefined) {
    conditions.push(`s.category_id = $${idx}`);
    params.push(filters.categoryId);
    idx++;
  }
  if (filters.branchId !== undefined) {
    conditions.push(`s.branch_id = $${idx}`);
    params.push(filters.branchId);
    idx++;
  }
  if (filters.isActive !== undefined) {
    conditions.push(`s.is_active = $${idx}`);
    params.push(filters.isActive);
    idx++;
  }
  if (filters.isFeatured !== undefined) {
    conditions.push(`s.is_featured = $${idx}`);
    params.push(filters.isFeatured);
    idx++;
  }
  if (filters.tags !== undefined && filters.tags.length > 0) {
    conditions.push(`s.tags && $${idx}`);
    params.push(filters.tags);
    idx++;
  }
  if (filters.resourceType !== undefined) {
    conditions.push(`s.resource_type = $${idx}`);
    params.push(filters.resourceType);
    idx++;
  }

  const { rows } = await db.query<ServiceRow>(
    `SELECT s.*, sc.name AS category_name, NULL::numeric AS avg_rating, 0 AS review_count
     FROM reservations.services s
     LEFT JOIN reservations.service_categories sc ON sc.id = s.category_id
     WHERE ${conditions.join(' AND ')}
     ORDER BY s.name ASC`,
    params,
  );

  return rows.map(mapService);
}

export async function updateService(
  serviceId: string,
  input: Partial<ServiceInput>,
  db: CatalogDB,
): Promise<BookableService> {
  const sets: string[] = [];
  const params: unknown[] = [];
  let idx = 1;

  const fieldMap: Array<[keyof ServiceInput, string]> = [
    ['name', 'name'],
    ['slug', 'slug'],
    ['branchId', 'branch_id'],
    ['categoryId', 'category_id'],
    ['shortDescription', 'short_description'],
    ['description', 'description'],
    ['durationMinutes', 'duration_minutes'],
    ['capacityMin', 'capacity_min'],
    ['capacityMax', 'capacity_max'],
    ['priceHellers', 'price_hellers'],
    ['priceType', 'price_type'],
    ['requiresResource', 'requires_resource'],
    ['resourceType', 'resource_type'],
    ['cancellationHours', 'cancellation_hours'],
    ['bookingWindowDays', 'booking_window_days'],
    ['minAdvanceHours', 'min_advance_hours'],
    ['images', 'images'],
    ['tags', 'tags'],
    ['metadata', 'metadata'],
    ['isActive', 'is_active'],
    ['isFeatured', 'is_featured'],
  ];

  for (const [camel, snake] of fieldMap) {
    if (input[camel] !== undefined) {
      sets.push(`${snake} = $${idx}`);
      params.push(camel === 'metadata' ? JSON.stringify(input[camel]) : input[camel]);
      idx++;
    }
  }

  // Always update updated_at
  sets.push(`updated_at = NOW()`);
  params.push(serviceId);

  const { rows } = await db.query<ServiceRow>(
    `UPDATE reservations.services
     SET ${sets.join(', ')}
     WHERE id = $${idx}
     RETURNING *, NULL AS category_name, NULL AS avg_rating, 0 AS review_count`,
    params,
  );

  if (!rows[0]) {
    throw new CatalogError('SERVICE_NOT_FOUND');
  }

  return mapService(rows[0]);
}

export async function searchServices(
  promoterId: string,
  query: string,
  db: CatalogDB,
): Promise<BookableService[]> {
  const pattern = `%${query}%`;

  const { rows } = await db.query<ServiceRow>(
    `SELECT s.*, sc.name AS category_name, NULL::numeric AS avg_rating, 0 AS review_count
     FROM reservations.services s
     LEFT JOIN reservations.service_categories sc ON sc.id = s.category_id
     WHERE s.promoter_id = $1
       AND s.is_active = true
       AND (
         s.name ILIKE $2
         OR s.description ILIKE $2
         OR s.short_description ILIKE $2
         OR EXISTS (
           SELECT 1 FROM unnest(s.tags) t WHERE t ILIKE $2
         )
       )
     ORDER BY s.name ASC`,
    [promoterId, pattern],
  );

  return rows.map(mapService);
}

export async function linkResource(
  serviceId: string,
  resourceId: string,
  isPrimary: boolean,
  db: CatalogDB,
): Promise<ServiceResource> {
  const { rows } = await db.query<ResourceLinkRow>(
    `INSERT INTO reservations.service_resources (service_id, resource_id, is_primary)
     VALUES ($1, $2, $3)
     RETURNING *`,
    [serviceId, resourceId, isPrimary],
  );

  if (!rows[0]) {
    throw new CatalogError('RESOURCE_LINK_EXISTS');
  }

  return {
    serviceId: rows[0].service_id,
    resourceId: rows[0].resource_id,
    isPrimary: rows[0].is_primary,
  };
}

export async function unlinkResource(
  serviceId: string,
  resourceId: string,
  db: CatalogDB,
): Promise<void> {
  await db.execute(
    `DELETE FROM reservations.service_resources
     WHERE service_id = $1 AND resource_id = $2`,
    [serviceId, resourceId],
  );
}

export async function getLinkedResources(
  serviceId: string,
  db: CatalogDB,
): Promise<ServiceResource[]> {
  const { rows } = await db.query<ResourceLinkRow>(
    `SELECT * FROM reservations.service_resources
     WHERE service_id = $1`,
    [serviceId],
  );

  return rows.map((r) => ({
    serviceId: r.service_id,
    resourceId: r.resource_id,
    isPrimary: r.is_primary,
  }));
}

export async function featureService(
  serviceId: string,
  db: CatalogDB,
): Promise<void> {
  await db.execute(
    `UPDATE reservations.services SET is_featured = true, updated_at = NOW() WHERE id = $1`,
    [serviceId],
  );
}

export async function unfeatureService(
  serviceId: string,
  db: CatalogDB,
): Promise<void> {
  await db.execute(
    `UPDATE reservations.services SET is_featured = false, updated_at = NOW() WHERE id = $1`,
    [serviceId],
  );
}
