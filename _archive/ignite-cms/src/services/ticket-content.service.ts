// =============================================================================
// Ignite CMS — branded ticket content service (Feature #48)
//
// Promotér edituje obsah digitální vstupenky: venue info, mapa, počasí,
// upsell bloky, sponzorský obsah.
//
// SCHEMA: ignite.ticket_content (migration 110)
// =============================================================================

export interface VenueInfo {
  address: string;
  directions?: string;
  parking?: string;
  accessibility?: string;
}

export interface MapConfig {
  lat: number;
  lng: number;
  zoom?: number;
  markerLabel?: string;
}

export interface UpsellBlock {
  title: string;
  description?: string;
  imageUrl?: string;
  ctaUrl: string;
  ctaLabel: string;
}

export interface SponsorBlock {
  name: string;
  logoUrl: string;
  url?: string;
  displayOrder: number;
}

export interface TicketContent {
  id: string;
  eventId: string;
  promoterId: string;
  venueInfo: VenueInfo | null;
  mapConfig: MapConfig | null;
  upsellBlocks: UpsellBlock[];
  sponsorBlocks: SponsorBlock[];
  customMessage: string | null;
  weatherEnabled: boolean;
  isPublished: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface UpsertTicketContentInput {
  venueInfo?: VenueInfo | null;
  mapConfig?: MapConfig | null;
  upsellBlocks?: UpsellBlock[];
  sponsorBlocks?: SponsorBlock[];
  customMessage?: string | null;
  weatherEnabled?: boolean;
  isPublished?: boolean;
}

// ---------------------------------------------------------------------------
// DB adapter (minimal — mirrors @tixly/db-adapter interface)
// ---------------------------------------------------------------------------

export interface DbAdapter {
  query<T>(sql: string, params?: unknown[]): Promise<T[]>;
  execute(sql: string, params?: unknown[]): Promise<void>;
}

// ---------------------------------------------------------------------------
// Row type
// ---------------------------------------------------------------------------

interface ContentRow {
  id: string;
  event_id: string;
  promoter_id: string;
  venue_info: VenueInfo | null;
  map_config: MapConfig | null;
  upsell_blocks: UpsellBlock[];
  sponsor_blocks: SponsorBlock[];
  custom_message: string | null;
  weather_enabled: boolean;
  is_published: boolean;
  created_at: string;
  updated_at: string;
}

function mapRow(row: ContentRow): TicketContent {
  return {
    id: row.id,
    eventId: row.event_id,
    promoterId: row.promoter_id,
    venueInfo: row.venue_info,
    mapConfig: row.map_config,
    upsellBlocks: row.upsell_blocks ?? [],
    sponsorBlocks: row.sponsor_blocks ?? [],
    customMessage: row.custom_message,
    weatherEnabled: row.weather_enabled,
    isPublished: row.is_published,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

function validateInput(input: UpsertTicketContentInput): void {
  if (input.customMessage !== undefined && input.customMessage !== null) {
    if (input.customMessage.length > 500) {
      throw new Error('VALIDATION_ERROR: customMessage exceeds 500 characters');
    }
  }
  if (input.upsellBlocks) {
    if (input.upsellBlocks.length > 10) {
      throw new Error('VALIDATION_ERROR: maximum 10 upsell blocks allowed');
    }
  }
  if (input.sponsorBlocks) {
    if (input.sponsorBlocks.length > 5) {
      throw new Error('VALIDATION_ERROR: maximum 5 sponsor blocks allowed');
    }
  }
}

// ---------------------------------------------------------------------------
// Service functions
// ---------------------------------------------------------------------------

export async function getTicketContent(
  eventId: string,
  promoterId: string,
  db: DbAdapter,
): Promise<TicketContent | null> {
  const rows = await db.query<ContentRow>(
    `SELECT * FROM ignite.ticket_content
     WHERE event_id = $1 AND promoter_id = $2`,
    [eventId, promoterId],
  );
  return rows[0] ? mapRow(rows[0]) : null;
}

export async function upsertTicketContent(
  eventId: string,
  promoterId: string,
  input: UpsertTicketContentInput,
  db: DbAdapter,
): Promise<TicketContent> {
  validateInput(input);

  const rows = await db.query<ContentRow>(
    `INSERT INTO ignite.ticket_content
       (event_id, promoter_id, venue_info, map_config, upsell_blocks, sponsor_blocks,
        custom_message, weather_enabled, is_published)
     VALUES ($1, $2, $3::jsonb, $4::jsonb, $5::jsonb, $6::jsonb, $7, $8, $9)
     ON CONFLICT (event_id) DO UPDATE
       SET venue_info      = COALESCE(EXCLUDED.venue_info,     ignite.ticket_content.venue_info),
           map_config      = COALESCE(EXCLUDED.map_config,     ignite.ticket_content.map_config),
           upsell_blocks   = EXCLUDED.upsell_blocks,
           sponsor_blocks  = EXCLUDED.sponsor_blocks,
           custom_message  = EXCLUDED.custom_message,
           weather_enabled = EXCLUDED.weather_enabled,
           is_published    = EXCLUDED.is_published,
           updated_at      = NOW()
     RETURNING *`,
    [
      eventId,
      promoterId,
      input.venueInfo !== undefined ? JSON.stringify(input.venueInfo) : null,
      input.mapConfig !== undefined ? JSON.stringify(input.mapConfig) : null,
      JSON.stringify(input.upsellBlocks ?? []),
      JSON.stringify(input.sponsorBlocks ?? []),
      input.customMessage ?? null,
      input.weatherEnabled ?? false,
      input.isPublished ?? false,
    ],
  );

  if (!rows[0]) {
    throw new Error('INTERNAL_ERROR: upsert returned no rows');
  }

  return mapRow(rows[0]);
}

export async function publishTicketContent(
  eventId: string,
  promoterId: string,
  db: DbAdapter,
): Promise<TicketContent> {
  const rows = await db.query<ContentRow>(
    `UPDATE ignite.ticket_content
     SET is_published = true, updated_at = NOW()
     WHERE event_id = $1 AND promoter_id = $2 -- tenant-scoped
     RETURNING *`,
    [eventId, promoterId],
  );
  if (!rows[0]) {
    throw new Error('NOT_FOUND: Ticket content not found for this event');
  }
  return mapRow(rows[0]);
}

export async function deleteTicketContent(
  eventId: string,
  promoterId: string,
  db: DbAdapter,
): Promise<void> {
  await db.execute(
    `DELETE FROM ignite.ticket_content
     WHERE event_id = $1 AND promoter_id = $2`, // tenant-scoped
    [eventId, promoterId],
  );
}
