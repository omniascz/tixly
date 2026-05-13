// =============================================================================
// Social integrations — Facebook Events / TikTok (Feature #53)
//
// Auto-publish akce na Facebook Events + "Get Tickets" tlačítko.
// TikTok: "Buy Tickets" v bio a videích.
//
// SCHEMA: social.* (migration 115)
// =============================================================================

export type SocialPlatform = 'facebook' | 'tiktok';
export type PublishStatus = 'draft' | 'published' | 'failed';

export interface SocialEventShare {
  id: string;
  eventId: string;
  promoterId: string;
  platform: SocialPlatform;
  externalEventId: string | null;     // FB event ID nebo TikTok video ID
  status: PublishStatus;
  errorMessage: string | null;
  publishedAt: string | null;
  createdAt: string;
}

export interface CreateShareInput {
  platform: SocialPlatform;
}

export interface DbAdapter {
  query<T>(sql: string, params?: unknown[]): Promise<T[]>;
  execute(sql: string, params?: unknown[]): Promise<void>;
  transaction<T>(fn: (tx: DbAdapter) => Promise<T>): Promise<T>;
}

export interface SocialAdapter {
  /** Publikuje event na sociální síť, vrátí external event ID. */
  publishEvent(
    eventId: string,
    eventTitle: string,
    eventDescription: string,
    eventDate: string,
    venueAddress: string,
    ticketUrl: string,
  ): Promise<{ externalEventId: string }>;

  /** Vrátí URL pro přidání linkého na "Buy Tickets" v bio/video */
  getTicketLinkUrl(ticketUrl: string): Promise<string>;
}

interface SocialShareRow {
  id: string;
  event_id: string;
  promoter_id: string;
  platform: SocialPlatform;
  external_event_id: string | null;
  status: PublishStatus;
  error_message: string | null;
  published_at: string | null;
  created_at: string;
}

function mapShare(row: SocialShareRow): SocialEventShare {
  return {
    id: row.id,
    eventId: row.event_id,
    promoterId: row.promoter_id,
    platform: row.platform,
    externalEventId: row.external_event_id,
    status: row.status,
    errorMessage: row.error_message,
    publishedAt: row.published_at,
    createdAt: row.created_at,
  };
}

/**
 * Vytvoří záznam o sdílení na sociální síť (draft status).
 */
export async function createSocialShare(
  eventId: string,
  promoterId: string,
  input: CreateShareInput,
  db: DbAdapter,
): Promise<SocialEventShare> {
  const rows = await db.query<SocialShareRow>(
    `INSERT INTO social.event_shares (event_id, promoter_id, platform)
     VALUES ($1, $2, $3)
     RETURNING *`,
    [eventId, promoterId, input.platform],
  );
  if (!rows[0]) throw new Error('INTERNAL_ERROR: share creation failed');
  return mapShare(rows[0]);
}

/**
 * Publikuje event na sociální síť a aktualizuje status.
 * Tenant-scoped na promoter_id.
 */
export async function publishToSocial(
  shareId: string,
  promoterId: string,
  adapter: SocialAdapter,
  eventData: {
    title: string;
    description: string;
    date: string;
    venueAddress: string;
    ticketUrl: string;
  },
  db: DbAdapter,
): Promise<SocialEventShare> {
  const shares = await db.query<SocialShareRow>(
    `SELECT * FROM social.event_shares WHERE id = $1 AND promoter_id = $2`,
    [shareId, promoterId],
  );
  if (!shares[0]) throw new Error('NOT_FOUND: Share not found');

  const share = shares[0];
  let externalEventId: string | null = null;
  let status: PublishStatus = 'published';
  let errorMessage: string | null = null;

  try {
    const result = await adapter.publishEvent(
      share.event_id,
      eventData.title,
      eventData.description,
      eventData.date,
      eventData.venueAddress,
      eventData.ticketUrl,
    );
    externalEventId = result.externalEventId;
  } catch (err) {
    status = 'failed';
    errorMessage = err instanceof Error ? err.message : String(err);
  }

  const rows = await db.query<SocialShareRow>(
    `UPDATE social.event_shares
     SET status = $1, external_event_id = $2, error_message = $3, published_at = CASE WHEN $1 = 'published' THEN NOW() ELSE NULL END
     WHERE id = $4 AND promoter_id = $5
     RETURNING *`,
    [status, externalEventId, errorMessage, shareId, promoterId],
  );
  if (!rows[0]) throw new Error('NOT_FOUND: Share not found');
  return mapShare(rows[0]);
}

/**
 * Vrátí seznam shares pro event (tenant-scoped).
 */
export async function listSocialShares(
  eventId: string,
  promoterId: string,
  db: DbAdapter,
): Promise<SocialEventShare[]> {
  const rows = await db.query<SocialShareRow>(
    `SELECT * FROM social.event_shares
     WHERE event_id = $1 AND promoter_id = $2
     ORDER BY created_at`,
    [eventId, promoterId],
  );
  return rows.map(mapShare);
}
