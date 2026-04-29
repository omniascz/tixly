// =============================================================================
// Find My Friends — Location sharing at venue (Feature #58)
//
// Fanoušci ve venue si sdílejí polohu a najdou se.
// Privacy-first (opt-in). Modul pod QR kódem na vstupence.
//
// SCHEMA: venue_features.* (migration 117)
// =============================================================================

export interface FriendLocation {
  id: string;
  eventId: string;
  userId: string;
  userDisplayName: string;
  latitude: number;
  longitude: number;
  accuracy?: number;        // meters
  lastSeenAt: string;
  createdAt: string;
}

export interface ShareLocationInput {
  latitude: number;
  longitude: number;
  accuracy?: number;
  displayName: string;
}

export interface DbAdapter {
  query<T>(sql: string, params?: unknown[]): Promise<T[]>;
  execute(sql: string, params?: unknown[]): Promise<void>;
  transaction<T>(fn: (tx: DbAdapter) => Promise<T>): Promise<T>;
}

interface LocationRow {
  id: string;
  event_id: string;
  user_id: string;
  user_display_name: string;
  latitude: number;
  longitude: number;
  accuracy: number | null;
  last_seen_at: string;
  created_at: string;
}

function mapLocation(row: LocationRow): FriendLocation {
  return {
    id: row.id,
    eventId: row.event_id,
    userId: row.user_id,
    userDisplayName: row.user_display_name,
    latitude: row.latitude,
    longitude: row.longitude,
    accuracy: row.accuracy ?? undefined,
    lastSeenAt: row.last_seen_at,
    createdAt: row.created_at,
  };
}

/**
 * Sdílí polohu uživatele na event.
 * Upsert: pokud existuje, aktualizuje; pokud ne, vytvoří.
 */
export async function shareLocation(
  eventId: string,
  userId: string,
  input: ShareLocationInput,
  db: DbAdapter,
): Promise<FriendLocation> {
  if (!input.latitude || !input.longitude) {
    throw new Error('VALIDATION_ERROR: latitude and longitude required');
  }
  if (input.latitude < -90 || input.latitude > 90 || input.longitude < -180 || input.longitude > 180) {
    throw new Error('VALIDATION_ERROR: invalid coordinates');
  }
  const rows = await db.query<LocationRow>(
    `INSERT INTO venue_features.friend_locations
       (event_id, user_id, user_display_name, latitude, longitude, accuracy)
     VALUES ($1, $2, $3, $4, $5, $6)
     ON CONFLICT (event_id, user_id) DO UPDATE SET
       user_display_name = EXCLUDED.user_display_name,
       latitude = EXCLUDED.latitude,
       longitude = EXCLUDED.longitude,
       accuracy = EXCLUDED.accuracy,
       last_seen_at = NOW()
     RETURNING *`,
    [
      eventId,
      userId,
      input.displayName,
      input.latitude,
      input.longitude,
      input.accuracy ?? null,
    ],
  );
  if (!rows[0]) throw new Error('INTERNAL_ERROR: location share failed');
  return mapLocation(rows[0]);
}

/**
 * Vrátí aktivní polohy všech přátel na eventu (posledních 5 minut).
 * Vrací všechny, kteří se sdílí — bez filtering.
 * V praktické aplikaci by mohla být jména filtrována dle social graph.
 */
export async function getNearbyFriends(
  eventId: string,
  userId: string,
  radiusMeters: number = 100,
  db: DbAdapter,
): Promise<FriendLocation[]> {
  const rows = await db.query<LocationRow>(
    `SELECT * FROM venue_features.friend_locations
     WHERE event_id = $1 AND user_id != $2
     AND last_seen_at > NOW() - INTERVAL '5 minutes'
     -- Proximity filter: Haversine (aproximace)
     AND ST_DWithin(
       ST_Point(longitude, latitude)::geography,
       (SELECT ST_Point(longitude, latitude)::geography FROM venue_features.friend_locations WHERE event_id = $1 AND user_id = $2),
       $3
     )
     ORDER BY last_seen_at DESC`,
    [eventId, userId, radiusMeters],
  );
  return rows.map(mapLocation);
}

/**
 * Deaktivuje sdílení polohy na event.
 */
export async function stopSharingLocation(
  eventId: string,
  userId: string,
  db: DbAdapter,
): Promise<void> {
  await db.execute(
    `DELETE FROM venue_features.friend_locations
     WHERE event_id = $1 AND user_id = $2`,
    [eventId, userId],
  );
}

/**
 * Vyčistí staré polohy (starší než 1 den) — pro GDPR compliance.
 */
export async function cleanupExpiredLocations(db: DbAdapter): Promise<void> {
  await db.execute(
    `DELETE FROM venue_features.friend_locations
     WHERE last_seen_at < NOW() - INTERVAL '1 day'`,
    [],
  );
}
