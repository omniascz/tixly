import type {
  ResaleListing,
  WatchlistEntry,
  DbAdapter,
  RedisAdapter,
  EventBusAdapter,
  DbRow,
} from '../types/resale';

interface WatchlistRow extends DbRow {
  id: string;
  user_id: string;
  event_id: string;
  max_price: string | null;
  zone: string | null;
  notified_at: string | null;
  created_at: string;
}

interface TicketTypeRow extends DbRow {
  event_id: string;
  zone: string | null;
}

/** Redis TTL for watchlist notification throttling: 5 minutes */
const NOTIFY_THROTTLE_TTL_S = 300;

/** Redis TTL for per-watchlist-entry notification throttling: 24 hours (Feature #48) */
const NOTIFY_THROTTLE_PER_ENTRY_TTL_S = 86400;

function mapWatchlistEntry(row: WatchlistRow): WatchlistEntry {
  return {
    id: row.id,
    userId: row.user_id,
    eventId: row.event_id,
    maxPrice: row.max_price ? parseFloat(row.max_price) : null,
    zone: row.zone,
    notifiedAt: row.notified_at ? new Date(row.notified_at) : null,
    createdAt: new Date(row.created_at),
  };
}

export class WatchlistService {
  constructor(
    private readonly db: DbAdapter,
    private readonly redis: RedisAdapter,
    private readonly eventBus: EventBusAdapter,
  ) {}

  async addToWatchlist(
    userId: string,
    eventId: string,
    maxPrice?: number,
    zone?: string,
  ): Promise<WatchlistEntry> {
    // ON CONFLICT respects the UNIQUE (user_id, event_id) constraint — idempotent upsert
    const rows = await this.db.query<WatchlistRow>(
      `INSERT INTO resale.resale_watchlist (user_id, event_id, max_price, zone)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (user_id, event_id) DO UPDATE
         SET max_price = EXCLUDED.max_price,
             zone = EXCLUDED.zone
       RETURNING *`,
      [userId, eventId, maxPrice ?? null, zone ?? null],
    );

    return mapWatchlistEntry(rows[0]);
  }

  async removeFromWatchlist(userId: string, watchlistId: string): Promise<void> {
    const deleted = await this.db.query<DbRow>(
      `DELETE FROM resale.resale_watchlist
       WHERE id = $1 AND user_id = $2
       RETURNING id`,
      [watchlistId, userId],
    );

    if (deleted.length === 0) {
      // Either not found or doesn't belong to this user — silently ignore (idempotent)
    }
  }

  async getWatchlistForUser(userId: string): Promise<WatchlistEntry[]> {
    const rows = await this.db.query<WatchlistRow>(
      `SELECT * FROM resale.resale_watchlist WHERE user_id = $1 ORDER BY created_at DESC`,
      [userId],
    );

    return rows.map(mapWatchlistEntry);
  }

  /**
   * Notifies watchlist users when a new listing is created.
   * Matches on event_id, optional max_price, and optional zone.
   * Throttled: max one notification per user × event per 5 minutes (Redis TTL key).
   */
  async notifyWatchlistUsers(listing: ResaleListing): Promise<void> {
    // Resolve the event_id and zone for this listing's ticket
    const ticketTypeRows = await this.db.query<TicketTypeRow>(
      `SELECT tt.event_id, tt.zone
       FROM catalog.ticket_types tt
       JOIN tickets.tickets t ON t.ticket_type_id = tt.id
       WHERE t.id = $1`,
      [listing.ticketId],
    );

    if (ticketTypeRows.length === 0) return;

    const { event_id: eventId, zone: listingZone } = ticketTypeRows[0];

    // Find interested watchlist entries
    const watchlistRows = await this.db.query<WatchlistRow>(
      `SELECT * FROM resale.resale_watchlist
       WHERE event_id = $1
         AND (max_price IS NULL OR max_price >= $2)
         AND (zone IS NULL OR zone = $3)`,
      [eventId, listing.askPrice, listingZone ?? ''],
    );

    for (const entry of watchlistRows) {
      await this.notifyOneUser(entry, listing, eventId);
    }
  }

  /**
   * Notify all watchlist entries matching a newly-created listing (Feature #48).
   *
   * Matching rules:
   *  - watchlist.event_id == eventId
   *  - watchlist.zone is NULL OR watchlist.zone == listing zone
   *  - watchlist.max_price is NULL OR watchlist.max_price >= listing.askPrice
   *
   * Throttling:
   *  - Each watchlist entry is notified at most once per 24 hours (Redis key
   *    `watchlist:notified:{watchlistId}`, TTL 86400s).
   *  - This prevents notification storms when many listings drop simultaneously.
   *
   * The actual email/push delivery is handled by a separate consumer
   * subscribed to the `watchlist.match` event — this method only emits the
   * event and records `notified_at` in the DB.
   *
   * @returns counts so the caller can log/metric.
   */
  async notifyMatchingWatchers(
    listing: ResaleListing,
    eventId: string,
    zone: string | null,
  ): Promise<{ matched: number; notified: number; throttled: number }> {
    const watchlistRows = await this.db.query<WatchlistRow>(
      `SELECT * FROM resale.resale_watchlist
       WHERE event_id = $1
         AND (zone IS NULL OR zone = $2)
         AND (max_price IS NULL OR max_price >= $3)`,
      [eventId, zone, listing.askPrice],
    );

    let notified = 0;
    let throttled = 0;

    for (const entry of watchlistRows) {
      const throttleKey = `watchlist:notified:${entry.id}`;
      const alreadyNotified = await this.redis.get(throttleKey);

      if (alreadyNotified !== null) {
        throttled += 1;
        continue;
      }

      // Set throttle key first to avoid duplicate notifications under concurrent calls
      await this.redis.set(throttleKey, '1', NOTIFY_THROTTLE_PER_ENTRY_TTL_S);

      await this.eventBus.publish('watchlist.match', {
        watchlistId: entry.id,
        userId: entry.user_id,
        eventId,
        listingId: listing.id,
        askPrice: listing.askPrice,
        zone,
      });

      await this.db.query(
        `UPDATE resale.resale_watchlist SET notified_at = NOW() WHERE id = $1`,
        [entry.id],
      );

      notified += 1;
    }

    return { matched: watchlistRows.length, notified, throttled };
  }

  private async notifyOneUser(
    entry: WatchlistRow,
    listing: ResaleListing,
    eventId: string,
  ): Promise<void> {
    // Throttling: skip if the user was notified for this event within the last 5 minutes
    const throttleKey = `watchlist:notified:${entry.user_id}:${eventId}`;
    const alreadyNotified = await this.redis.get(throttleKey);

    if (alreadyNotified !== null) {
      return;
    }

    // Set throttle key before dispatching to avoid duplicate notifications under concurrent calls
    await this.redis.set(throttleKey, '1', NOTIFY_THROTTLE_TTL_S);

    // Dispatch notification via EventBus — push + email handled by notification service
    await this.eventBus.publish('notification.watchlist.match', {
      userId: entry.user_id,
      eventId,
      listingId: listing.id,
      askPrice: listing.askPrice,
      zone: entry.zone,
    });

    // Record notification timestamp
    await this.db.query(
      `UPDATE resale.resale_watchlist SET notified_at = NOW() WHERE id = $1`,
      [entry.id],
    );
  }
}
