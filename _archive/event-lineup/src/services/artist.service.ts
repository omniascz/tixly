// =============================================================================
// Artist Lineup Management — Spotify, Bandsintown, Songkick Integration
// Feature #28: Lineup / Artist tool
// =============================================================================

export interface Artist {
  id: string;
  eventId: string;
  promoterId: string;
  name: string;
  bio?: string;
  imageUrl?: string;
  stageOrder?: number;
  stageName?: string;
  performanceTime?: string;
  performanceDate?: string;
  genreTags: string[];
  createdAt: string;
  updatedAt: string;
}

export interface ArtistProfile {
  id: string;
  artistId: string;
  platform: 'spotify' | 'bandsintown' | 'songkick';
  profileId: string;
  profileUrl?: string;
  followerCount: number;
  monthlyListeners?: number;
  popularityScore: number;
  syncedAt: string;
}

export interface CreateArtistInput {
  eventId: string;
  name: string;
  bio?: string;
  imageUrl?: string;
  stageOrder?: number;
  stageName?: string;
  performanceTime?: string;
  performanceDate?: string;
  genreTags?: string[];
}

export interface ArtistMetadata {
  followerCount: number;
  monthlyListeners?: number;
  popularityScore: number;
  genres: string[];
}

export interface DbAdapter {
  query<T>(sql: string, params?: unknown[]): Promise<T[]>;
  execute(sql: string, params?: unknown[]): Promise<void>;
  transaction<T>(fn: (tx: DbAdapter) => Promise<T>): Promise<T>;
}

export interface ExternalArtistAdapter {
  searchArtist(name: string): Promise<{
    id: string;
    name: string;
    image?: string;
    genres?: string[];
    metadata?: ArtistMetadata;
  } | null>;
  getArtistMetadata(profileId: string): Promise<ArtistMetadata | null>;
}

interface ArtistRow {
  id: string;
  event_id: string;
  promoter_id: string;
  name: string;
  bio: string | null;
  image_url: string | null;
  stage_order: number | null;
  stage_name: string | null;
  performance_time: string | null;
  performance_date: string | null;
  genre_tags: string[];
  created_at: string;
  updated_at: string;
}

interface ArtistProfileRow {
  id: string;
  artist_id: string;
  platform: 'spotify' | 'bandsintown' | 'songkick';
  profile_id: string;
  profile_url: string | null;
  follower_count: number;
  monthly_listeners: number | null;
  popularity_score: number;
  synced_at: string;
}

function mapArtist(row: ArtistRow): Artist {
  return {
    id: row.id,
    eventId: row.event_id,
    promoterId: row.promoter_id,
    name: row.name,
    bio: row.bio || undefined,
    imageUrl: row.image_url || undefined,
    stageOrder: row.stage_order || undefined,
    stageName: row.stage_name || undefined,
    performanceTime: row.performance_time || undefined,
    performanceDate: row.performance_date || undefined,
    genreTags: row.genre_tags || [],
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function mapArtistProfile(row: ArtistProfileRow): ArtistProfile {
  return {
    id: row.id,
    artistId: row.artist_id,
    platform: row.platform,
    profileId: row.profile_id,
    profileUrl: row.profile_url || undefined,
    followerCount: row.follower_count,
    monthlyListeners: row.monthly_listeners || undefined,
    popularityScore: row.popularity_score,
    syncedAt: row.synced_at,
  };
}

/**
 * Create a new artist for an event lineup.
 */
export async function createArtist(
  promoterId: string,
  input: CreateArtistInput,
  db: DbAdapter,
): Promise<Artist> {
  if (!input.name) {
    throw new Error('VALIDATION_ERROR: name required');
  }

  const rows = await db.query<ArtistRow>(
    `INSERT INTO lineups.artists
       (event_id, promoter_id, name, bio, image_url, stage_order, stage_name,
        performance_time, performance_date, genre_tags)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
     RETURNING *`,
    [
      input.eventId,
      promoterId,
      input.name,
      input.bio || null,
      input.imageUrl || null,
      input.stageOrder || null,
      input.stageName || null,
      input.performanceTime || null,
      input.performanceDate || null,
      input.genreTags || [],
    ],
  );

  if (!rows[0]) throw new Error('INTERNAL_ERROR: artist creation failed');
  return mapArtist(rows[0]);
}

/**
 * Get all artists for an event (tenant-scoped, sorted by stage order).
 */
export async function getLineup(
  eventId: string,
  promoterId: string,
  db: DbAdapter,
): Promise<Artist[]> {
  const rows = await db.query<ArtistRow>(
    `SELECT * FROM lineups.artists
     WHERE event_id = $1 AND promoter_id = $2
     ORDER BY stage_order ASC, created_at ASC`,
    [eventId, promoterId],
  );
  return rows.map(mapArtist);
}

/**
 * Get a single artist by ID (tenant-scoped).
 */
export async function getArtist(
  artistId: string,
  promoterId: string,
  db: DbAdapter,
): Promise<Artist | null> {
  const rows = await db.query<ArtistRow>(
    `SELECT * FROM lineups.artists
     WHERE id = $1 AND promoter_id = $2`,
    [artistId, promoterId],
  );
  return rows[0] ? mapArtist(rows[0]) : null;
}

/**
 * Link an external artist profile (Spotify/Bandsintown/Songkick).
 * Upserts on (artist_id, platform) conflict.
 */
export async function linkArtistProfile(
  artistId: string,
  platform: 'spotify' | 'bandsintown' | 'songkick',
  profileId: string,
  metadata: ArtistMetadata,
  db: DbAdapter,
): Promise<ArtistProfile> {
  const rows = await db.query<ArtistProfileRow>(
    `INSERT INTO lineups.artist_profiles
       (artist_id, platform, profile_id, follower_count, monthly_listeners, popularity_score)
     VALUES ($1, $2, $3, $4, $5, $6)
     ON CONFLICT (artist_id, platform)
     DO UPDATE SET
       profile_id = $3,
       follower_count = $4,
       monthly_listeners = $5,
       popularity_score = $6,
       synced_at = NOW()
     RETURNING *`,
    [
      artistId,
      platform,
      profileId,
      metadata.followerCount,
      metadata.monthlyListeners || null,
      metadata.popularityScore,
    ],
  );

  if (!rows[0]) throw new Error('INTERNAL_ERROR: profile link failed');
  return mapArtistProfile(rows[0]);
}

/**
 * Get all profiles for an artist.
 */
export async function getArtistProfiles(
  artistId: string,
  db: DbAdapter,
): Promise<ArtistProfile[]> {
  const rows = await db.query<ArtistProfileRow>(
    `SELECT * FROM lineups.artist_profiles WHERE artist_id = $1`,
    [artistId],
  );
  return rows.map(mapArtistProfile);
}

/**
 * Update artist details (tenant-scoped).
 */
export async function updateArtist(
  artistId: string,
  promoterId: string,
  updates: Partial<CreateArtistInput>,
  db: DbAdapter,
): Promise<Artist> {
  const setClauses: string[] = [];
  const params: unknown[] = [artistId, promoterId];

  if (updates.name !== undefined) {
    setClauses.push(`name = $${params.length + 1}`);
    params.push(updates.name);
  }
  if (updates.bio !== undefined) {
    setClauses.push(`bio = $${params.length + 1}`);
    params.push(updates.bio || null);
  }
  if (updates.imageUrl !== undefined) {
    setClauses.push(`image_url = $${params.length + 1}`);
    params.push(updates.imageUrl || null);
  }
  if (updates.stageOrder !== undefined) {
    setClauses.push(`stage_order = $${params.length + 1}`);
    params.push(updates.stageOrder || null);
  }
  if (updates.stageName !== undefined) {
    setClauses.push(`stage_name = $${params.length + 1}`);
    params.push(updates.stageName || null);
  }
  if (updates.performanceTime !== undefined) {
    setClauses.push(`performance_time = $${params.length + 1}`);
    params.push(updates.performanceTime || null);
  }
  if (updates.performanceDate !== undefined) {
    setClauses.push(`performance_date = $${params.length + 1}`);
    params.push(updates.performanceDate || null);
  }
  if (updates.genreTags !== undefined) {
    setClauses.push(`genre_tags = $${params.length + 1}`);
    params.push(updates.genreTags || []);
  }

  if (setClauses.length === 0) {
    throw new Error('VALIDATION_ERROR: no fields to update');
  }

  setClauses.push(`updated_at = NOW()`);

  const rows = await db.query<ArtistRow>(
    `UPDATE lineups.artists
     SET ${setClauses.join(', ')}
     WHERE id = $1 AND promoter_id = $2
     RETURNING *`,
    params,
  );

  if (!rows[0]) throw new Error('INTERNAL_ERROR: artist not found or update failed');
  return mapArtist(rows[0]);
}

/**
 * Delete an artist from the lineup (tenant-scoped).
 */
export async function deleteArtist(
  artistId: string,
  promoterId: string,
  db: DbAdapter,
): Promise<void> {
  await db.execute(
    `DELETE FROM lineups.artists WHERE id = $1 AND promoter_id = $2`,
    [artistId, promoterId],
  );
}
