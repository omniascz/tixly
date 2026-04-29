// =============================================================================
// Spotify integrace — Artist ticket linking (Feature #56)
//
// "Get Tickets" na Spotify stránce umělce.
// Propojení fanoušků s historií poslechu.
//
// SCHEMA: music.* (migration 116)
// =============================================================================

export interface SpotifyArtistLink {
  id: string;
  eventId: string;
  artistSpotifyId: string;
  artistName: string;
  ticketUrl: string;
  status: 'active' | 'paused' | 'expired';
  linkedAt: string;
  expiresAt: string | null;
  createdAt: string;
}

export interface CreateArtistLinkInput {
  artistSpotifyId: string;
  artistName: string;
  ticketUrl: string;
  expiresAt?: string;
}

export interface DbAdapter {
  query<T>(sql: string, params?: unknown[]): Promise<T[]>;
  execute(sql: string, params?: unknown[]): Promise<void>;
  transaction<T>(fn: (tx: DbAdapter) => Promise<T>): Promise<T>;
}

interface ArtistLinkRow {
  id: string;
  event_id: string;
  artist_spotify_id: string;
  artist_name: string;
  ticket_url: string;
  status: string;
  linked_at: string;
  expires_at: string | null;
  created_at: string;
}

function mapArtistLink(row: ArtistLinkRow): SpotifyArtistLink {
  return {
    id: row.id,
    eventId: row.event_id,
    artistSpotifyId: row.artist_spotify_id,
    artistName: row.artist_name,
    ticketUrl: row.ticket_url,
    status: row.status as 'active' | 'paused' | 'expired',
    linkedAt: row.linked_at,
    expiresAt: row.expires_at,
    createdAt: row.created_at,
  };
}

/**
 * Vytvoří link Spotify artist → event tickets.
 * Umožňuje fanouškům koupit vstupenky přímo ze Spotify artist page.
 */
export async function createArtistLink(
  eventId: string,
  input: CreateArtistLinkInput,
  db: DbAdapter,
): Promise<SpotifyArtistLink> {
  if (!input.artistSpotifyId || !input.ticketUrl) {
    throw new Error('VALIDATION_ERROR: artistSpotifyId and ticketUrl required');
  }
  const rows = await db.query<ArtistLinkRow>(
    `INSERT INTO music.spotify_artist_links
       (event_id, artist_spotify_id, artist_name, ticket_url, expires_at)
     VALUES ($1, $2, $3, $4, $5)
     RETURNING *`,
    [
      eventId,
      input.artistSpotifyId,
      input.artistName,
      input.ticketUrl,
      input.expiresAt ?? null,
    ],
  );
  if (!rows[0]) throw new Error('INTERNAL_ERROR: link creation failed');
  return mapArtistLink(rows[0]);
}

/**
 * Vrátí link pro daného umělce u dané akce.
 */
export async function getArtistLink(
  eventId: string,
  artistSpotifyId: string,
  db: DbAdapter,
): Promise<SpotifyArtistLink | null> {
  const rows = await db.query<ArtistLinkRow>(
    `SELECT * FROM music.spotify_artist_links
     WHERE event_id = $1 AND artist_spotify_id = $2 AND status = 'active'`,
    [eventId, artistSpotifyId],
  );
  return rows[0] ? mapArtistLink(rows[0]) : null;
}

/**
 * Deaktivuje link (umělec už není součástí akce).
 */
export async function pauseArtistLink(
  linkId: string,
  db: DbAdapter,
): Promise<SpotifyArtistLink> {
  const rows = await db.query<ArtistLinkRow>(
    `UPDATE music.spotify_artist_links
     SET status = 'paused'
     WHERE id = $1 AND status = 'active'
     RETURNING *`,
    [linkId],
  );
  if (!rows[0]) throw new Error('NOT_FOUND: Link not found or already paused');
  return mapArtistLink(rows[0]);
}

/**
 * Vrátí všechny aktivní linky pro event.
 */
export async function listArtistLinks(eventId: string, db: DbAdapter): Promise<SpotifyArtistLink[]> {
  const rows = await db.query<ArtistLinkRow>(
    `SELECT * FROM music.spotify_artist_links
     WHERE event_id = $1 AND status = 'active' AND (expires_at IS NULL OR expires_at > NOW())
     ORDER BY linked_at DESC`,
    [eventId],
  );
  return rows.map(mapArtistLink);
}
