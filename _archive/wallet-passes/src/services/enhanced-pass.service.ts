// =============================================================================
// Enhanced Apple Wallet — Dynamic content (Feature #51)
//
// Dynamický obsah pasu: počasí v den akce, setlist, mapa venue, playlist.
// Push update bez akce uživatele (via Apple Wallet API).
//
// SCHEMA: passes.enhanced_content (migration 114)
// =============================================================================

export interface WeatherData {
  temperatureC?: number;
  condition?: string;     // 'sunny' | 'rainy' | 'cloudy' | 'snowy'
  icon?: string;          // emoji nebo URL
}

export interface VenueMapData {
  lat: number;
  lng: number;
  label?: string;
}

export interface SetlistItem {
  artistName: string;
  startTime?: string;     // ISO 8601
  duration?: number;      // minutes
}

export interface PlaylistData {
  spotifyPlaylistId?: string;
  title?: string;
  trackCount?: number;
}

export interface EnhancedPassContent {
  id: string;
  passId: string;
  eventId: string;
  weather: WeatherData | null;
  venueMap: VenueMapData | null;
  setlist: SetlistItem[];
  playlist: PlaylistData | null;
  lastUpdatedAt: string;
  lastPushedAt: string | null;
}

export interface UpdateEnhancedContentInput {
  weather?: WeatherData | null;
  venueMap?: VenueMapData | null;
  setlist?: SetlistItem[];
  playlist?: PlaylistData | null;
}

export interface DbAdapter {
  query<T>(sql: string, params?: unknown[]): Promise<T[]>;
  execute(sql: string, params?: unknown[]): Promise<void>;
  transaction<T>(fn: (tx: DbAdapter) => Promise<T>): Promise<T>;
}

interface EnhancedContentRow {
  id: string;
  pass_id: string;
  event_id: string;
  weather: Record<string, unknown> | null;
  venue_map: Record<string, unknown> | null;
  setlist: Record<string, unknown>[];
  playlist: Record<string, unknown> | null;
  last_updated_at: string;
  last_pushed_at: string | null;
}

function mapEnhancedContent(row: EnhancedContentRow): EnhancedPassContent {
  return {
    id: row.id,
    passId: row.pass_id,
    eventId: row.event_id,
    weather: (row.weather as WeatherData) ?? null,
    venueMap: (row.venue_map as VenueMapData) ?? null,
    setlist: (row.setlist as SetlistItem[]) ?? [],
    playlist: (row.playlist as PlaylistData) ?? null,
    lastUpdatedAt: row.last_updated_at,
    lastPushedAt: row.last_pushed_at,
  };
}

/**
 * Aktualizuje dynamický obsah pasu.
 * Upsert: pokud neexistuje, vytvoří; pokud existuje, aktualizuje.
 */
export async function updateEnhancedContent(
  passId: string,
  eventId: string,
  input: UpdateEnhancedContentInput,
  db: DbAdapter,
): Promise<EnhancedPassContent> {
  const rows = await db.query<EnhancedContentRow>(
    `INSERT INTO passes.enhanced_content
       (pass_id, event_id, weather, venue_map, setlist, playlist)
     VALUES ($1, $2, $3::jsonb, $4::jsonb, $5::jsonb, $6::jsonb)
     ON CONFLICT (pass_id) DO UPDATE SET
       weather = COALESCE(EXCLUDED.weather, passes.enhanced_content.weather),
       venue_map = COALESCE(EXCLUDED.venue_map, passes.enhanced_content.venue_map),
       setlist = COALESCE(EXCLUDED.setlist, passes.enhanced_content.setlist),
       playlist = COALESCE(EXCLUDED.playlist, passes.enhanced_content.playlist),
       last_updated_at = NOW()
     RETURNING *`,
    [
      passId,
      eventId,
      input.weather ? JSON.stringify(input.weather) : null,
      input.venueMap ? JSON.stringify(input.venueMap) : null,
      JSON.stringify(input.setlist ?? []),
      input.playlist ? JSON.stringify(input.playlist) : null,
    ],
  );
  if (!rows[0]) throw new Error('INTERNAL_ERROR: enhanced content upsert failed');
  return mapEnhancedContent(rows[0]);
}

/**
 * Vrátí dynamický obsah pasu.
 */
export async function getEnhancedContent(passId: string, db: DbAdapter): Promise<EnhancedPassContent | null> {
  const rows = await db.query<EnhancedContentRow>(
    `SELECT * FROM passes.enhanced_content WHERE pass_id = $1`,
    [passId],
  );
  return rows[0] ? mapEnhancedContent(rows[0]) : null;
}

/**
 * Simuluje push notifikace do Apple Wallet (v produkci: volá Apple Wallet API).
 * Markuje last_pushed_at.
 */
export async function pushToWallet(passId: string, db: DbAdapter): Promise<EnhancedPassContent> {
  const rows = await db.query<EnhancedContentRow>(
    `UPDATE passes.enhanced_content
     SET last_pushed_at = NOW()
     WHERE pass_id = $1
     RETURNING *`,
    [passId],
  );
  if (!rows[0]) throw new Error('NOT_FOUND: Enhanced content not found');
  return mapEnhancedContent(rows[0]);
}
