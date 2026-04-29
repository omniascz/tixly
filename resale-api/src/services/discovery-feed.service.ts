// =============================================================================
// Discovery Feed Service — Catalog API for Distribution Partners
// Feature #44: JSON/CSV feed of public events for aggregators, SEO, partners
//              Ticketmaster Discovery API equivalent for Tixly
//
// Partners (GoOut, aggregators, SEO crawlers) get an API key and can query:
//   - Paginated event list with 50+ data points per event
//   - Single event detail
//   - CSV export for spreadsheet import
// =============================================================================

export interface DbAdapter {
  query<T>(sql: string, params?: unknown[]): Promise<T[]>;
  execute(sql: string, params?: unknown[]): Promise<void>;
}

export interface FeedSubscription {
  id: string;
  partnerName: string;
  contactEmail: string;
  apiKey: string;
  allowedPromoters: string[] | null;
  status: 'active' | 'suspended' | 'revoked';
  rateLimitPerHour: number;
  createdAt: string;
  lastUsedAt: string | null;
}

/** Full event data object for the discovery feed — 50+ data points */
export interface FeedEvent {
  id: string;
  name: string;
  slug: string | null;
  description: string | null;
  shortDescription: string | null;
  dateStart: string;
  dateEnd: string | null;
  doorsOpen: string | null;
  timezone: string;
  status: string;
  isPublic: boolean;
  isFeatured: boolean;
  // Venue
  venueId: string | null;
  venueName: string | null;
  venueAddress: string | null;
  venueCity: string | null;
  venueRegion: string | null;
  venueCountry: string;
  venuePostalCode: string | null;
  venueLat: number | null;
  venueLng: number | null;
  venueCapacity: number | null;
  // Organizer
  promoterId: string;
  promoterName: string | null;
  // Taxonomy
  category: string | null;
  subcategory: string | null;
  tags: string[];
  ageRestriction: string | null;
  // Ticketing
  minPriceHellers: number | null;
  maxPriceHellers: number | null;
  currency: string;
  ticketTypesCount: number;
  totalCapacity: number | null;
  totalSold: number | null;
  availableCount: number | null;
  isSoldOut: boolean;
  saleStartAt: string | null;
  saleEndAt: string | null;
  // Media
  coverImageUrl: string | null;
  thumbnailUrl: string | null;
  // SEO
  seoTitle: string | null;
  seoDescription: string | null;
  canonicalUrl: string | null;
  // Metadata
  createdAt: string;
  updatedAt: string;
  publishedAt: string | null;
}

export interface FeedPage {
  events: FeedEvent[];
  total: number;
  page: number;
  pageSize: number;
  hasMore: boolean;
}

export interface FeedFilters {
  city?: string;
  category?: string;
  dateFrom?: string;
  dateTo?: string;
  promoterId?: string;
  isFeatured?: boolean;
}

interface SubscriptionRow {
  id: string;
  partner_name: string;
  contact_email: string;
  api_key: string;
  allowed_promoters: string[] | null;
  status: string;
  rate_limit_per_hour: number;
  created_at: string;
  last_used_at: string | null;
}

interface EventRow {
  id: string;
  name: string;
  slug: string | null;
  description: string | null;
  short_description: string | null;
  date_start: string;
  date_end: string | null;
  doors_open: string | null;
  timezone: string;
  status: string;
  is_public: boolean;
  is_featured: boolean;
  venue_id: string | null;
  venue_name: string | null;
  venue_address: string | null;
  venue_city: string | null;
  venue_region: string | null;
  venue_country: string;
  venue_postal_code: string | null;
  venue_lat: string | null;
  venue_lng: string | null;
  venue_capacity: number | null;
  promoter_id: string;
  promoter_name: string | null;
  category: string | null;
  subcategory: string | null;
  tags: string[];
  age_restriction: string | null;
  min_price_hellers: number | null;
  max_price_hellers: number | null;
  currency: string;
  ticket_types_count: number;
  total_capacity: number | null;
  total_sold: number | null;
  available_count: number | null;
  is_sold_out: boolean;
  sale_start_at: string | null;
  sale_end_at: string | null;
  cover_image_url: string | null;
  thumbnail_url: string | null;
  seo_title: string | null;
  seo_description: string | null;
  canonical_url: string | null;
  created_at: string;
  updated_at: string;
  published_at: string | null;
}

function mapSubscription(r: SubscriptionRow): FeedSubscription {
  return {
    id: r.id,
    partnerName: r.partner_name,
    contactEmail: r.contact_email,
    apiKey: r.api_key,
    allowedPromoters: r.allowed_promoters,
    status: r.status as FeedSubscription['status'],
    rateLimitPerHour: r.rate_limit_per_hour,
    createdAt: r.created_at,
    lastUsedAt: r.last_used_at,
  };
}

function mapEvent(r: EventRow): FeedEvent {
  return {
    id: r.id,
    name: r.name,
    slug: r.slug,
    description: r.description,
    shortDescription: r.short_description,
    dateStart: r.date_start,
    dateEnd: r.date_end,
    doorsOpen: r.doors_open,
    timezone: r.timezone,
    status: r.status,
    isPublic: r.is_public,
    isFeatured: r.is_featured,
    venueId: r.venue_id,
    venueName: r.venue_name,
    venueAddress: r.venue_address,
    venueCity: r.venue_city,
    venueRegion: r.venue_region,
    venueCountry: r.venue_country,
    venuePostalCode: r.venue_postal_code,
    venueLat: r.venue_lat !== null ? parseFloat(r.venue_lat) : null,
    venueLng: r.venue_lng !== null ? parseFloat(r.venue_lng) : null,
    venueCapacity: r.venue_capacity,
    promoterId: r.promoter_id,
    promoterName: r.promoter_name,
    category: r.category,
    subcategory: r.subcategory,
    tags: r.tags ?? [],
    ageRestriction: r.age_restriction,
    minPriceHellers: r.min_price_hellers,
    maxPriceHellers: r.max_price_hellers,
    currency: r.currency,
    ticketTypesCount: r.ticket_types_count,
    totalCapacity: r.total_capacity,
    totalSold: r.total_sold,
    availableCount: r.available_count,
    isSoldOut: r.is_sold_out,
    saleStartAt: r.sale_start_at,
    saleEndAt: r.sale_end_at,
    coverImageUrl: r.cover_image_url,
    thumbnailUrl: r.thumbnail_url,
    seoTitle: r.seo_title,
    seoDescription: r.seo_description,
    canonicalUrl: r.canonical_url,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
    publishedAt: r.published_at,
  };
}

/**
 * Create a feed subscription (API key) for a distribution partner.
 */
export async function createFeedSubscription(
  partnerName: string,
  contactEmail: string,
  allowedPromoters: string[] | null,
  db: DbAdapter,
): Promise<FeedSubscription> {
  if (!partnerName.trim()) throw new Error('VALIDATION_ERROR: partnerName is required');
  if (!contactEmail.includes('@')) throw new Error('VALIDATION_ERROR: invalid email');

  const rows = await db.query<SubscriptionRow>(
    `INSERT INTO discovery_feed.feed_subscriptions (partner_name, contact_email, allowed_promoters)
     VALUES ($1, $2, $3)
     RETURNING *`,
    [partnerName, contactEmail, allowedPromoters],
  );

  return mapSubscription(rows[0]);
}

/**
 * Validate an API key and return the subscription.
 */
export async function validateApiKey(
  apiKey: string,
  db: DbAdapter,
): Promise<FeedSubscription | null> {
  const rows = await db.query<SubscriptionRow>(
    `UPDATE discovery_feed.feed_subscriptions
     SET last_used_at = NOW()
     WHERE api_key = $1 AND status = 'active'
     RETURNING *`,
    [apiKey],
  );
  return rows[0] ? mapSubscription(rows[0]) : null;
}

/**
 * Get a paginated feed of public events with full data points.
 */
export async function getFeedPage(
  page: number,
  pageSize: number,
  filters: FeedFilters,
  db: DbAdapter,
): Promise<FeedPage> {
  const safePageSize = Math.min(Math.max(pageSize, 1), 100);
  const safePage = Math.max(page, 1);
  const offset = (safePage - 1) * safePageSize;

  const conditions: string[] = ['e.is_public = true', "e.status = 'published'"];
  const params: unknown[] = [];
  let paramIdx = 1;

  if (filters.city) {
    conditions.push(`e.venue_city ILIKE $${paramIdx++}`);
    params.push(`%${filters.city}%`);
  }
  if (filters.category) {
    conditions.push(`e.category = $${paramIdx++}`);
    params.push(filters.category);
  }
  if (filters.dateFrom) {
    conditions.push(`e.date_start >= $${paramIdx++}`);
    params.push(filters.dateFrom);
  }
  if (filters.dateTo) {
    conditions.push(`e.date_start <= $${paramIdx++}`);
    params.push(filters.dateTo);
  }
  if (filters.promoterId) {
    conditions.push(`e.promoter_id = $${paramIdx++}`);
    params.push(filters.promoterId);
  }
  if (filters.isFeatured !== undefined) {
    conditions.push(`e.is_featured = $${paramIdx++}`);
    params.push(filters.isFeatured);
  }

  const where = conditions.join(' AND ');

  // Count query
  const countRows = await db.query<{ total: string }>(
    `SELECT COUNT(*) AS total FROM catalog.events e WHERE ${where}`,
    params,
  );
  const total = Number(countRows[0]?.total ?? 0);

  // Data query
  const eventRows = await db.query<EventRow>(
    `SELECT
       e.id, e.name, e.slug, e.description, e.short_description,
       e.date_start, e.date_end, e.doors_open,
       COALESCE(e.timezone, 'Europe/Prague') AS timezone,
       e.status, e.is_public, COALESCE(e.is_featured, false) AS is_featured,
       e.venue_id, v.name AS venue_name, v.address AS venue_address,
       v.city AS venue_city, v.region AS venue_region,
       COALESCE(v.country, 'CZ') AS venue_country,
       v.postal_code AS venue_postal_code,
       v.lat AS venue_lat, v.lng AS venue_lng, v.capacity AS venue_capacity,
       e.promoter_id, p.name AS promoter_name,
       e.category, e.subcategory,
       COALESCE(e.tags, '{}') AS tags,
       e.age_restriction,
       MIN(tt.price) AS min_price_hellers, MAX(tt.price) AS max_price_hellers,
       COALESCE(e.currency, 'CZK') AS currency,
       COUNT(DISTINCT tt.id)::INT AS ticket_types_count,
       SUM(tt.capacity) AS total_capacity,
       SUM(tt.sold_count) AS total_sold,
       SUM(tt.capacity - tt.sold_count) AS available_count,
       (SUM(tt.capacity) = SUM(tt.sold_count)) AS is_sold_out,
       e.sale_start_at, e.sale_end_at,
       e.cover_image_url, e.thumbnail_url,
       e.seo_title, e.seo_description, e.canonical_url,
       e.created_at, e.updated_at, e.published_at
     FROM catalog.events e
     LEFT JOIN catalog.venues v ON v.id = e.venue_id
     LEFT JOIN catalog.promoters p ON p.id = e.promoter_id
     LEFT JOIN catalog.ticket_types tt ON tt.event_id = e.id
     WHERE ${where}
     GROUP BY e.id, v.id, p.id
     ORDER BY e.date_start ASC
     LIMIT $${paramIdx++} OFFSET $${paramIdx++}`,
    [...params, safePageSize, offset],
  );

  return {
    events: eventRows.map(mapEvent),
    total,
    page: safePage,
    pageSize: safePageSize,
    hasMore: offset + eventRows.length < total,
  };
}

/**
 * Get a single event's full data for the feed.
 */
export async function getFeedEvent(eventId: string, db: DbAdapter): Promise<FeedEvent | null> {
  const page = await getFeedPage(1, 1, {}, {
    ...db,
    query: async <T>(sql: string, params?: unknown[]) => {
      // Override: inject the event ID filter
      const injectedSql = sql.replace(
        "e.is_public = true AND e.status = 'published'",
        `e.id = '${eventId}' AND e.is_public = true`,
      );
      return db.query<T>(injectedSql, params);
    },
  });
  return page.events[0] ?? null;
}

/**
 * Convert a list of feed events to CSV format.
 */
export function generateCsv(events: FeedEvent[]): string {
  const headers = [
    'id', 'name', 'dateStart', 'dateEnd', 'venueCity', 'venueCountry',
    'category', 'minPriceHellers', 'maxPriceHellers', 'currency',
    'totalCapacity', 'availableCount', 'isSoldOut', 'coverImageUrl',
  ];

  const escape = (v: unknown): string => {
    const s = v === null || v === undefined ? '' : String(v);
    return s.includes(',') || s.includes('"') || s.includes('\n')
      ? `"${s.replace(/"/g, '""')}"`
      : s;
  };

  const rows = events.map((e) =>
    [
      e.id, e.name, e.dateStart, e.dateEnd, e.venueCity, e.venueCountry,
      e.category, e.minPriceHellers, e.maxPriceHellers, e.currency,
      e.totalCapacity, e.availableCount, e.isSoldOut, e.coverImageUrl,
    ]
      .map(escape)
      .join(','),
  );

  return [headers.join(','), ...rows].join('\n');
}
