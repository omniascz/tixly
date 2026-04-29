// =============================================================================
// Promoter Profile Service
// Feature #184: Public branded profile page with events list and follow feature
//
// Distinct from internal promoter admin data — this is the public-facing view:
//   - Bio, social media links, cover image
//   - Upcoming and past events (public only)
//   - Follow / unfollow for new event notifications
// =============================================================================

export interface DbAdapter {
  query<T>(sql: string, params?: unknown[]): Promise<T[]>;
  execute(sql: string, params?: unknown[]): Promise<void>;
}

export interface PromoterProfile {
  promoterId: string;
  name: string;
  slug: string | null;
  logoUrl: string | null;
  coverImageUrl: string | null;
  bio: string | null;
  website: string | null;
  facebookUrl: string | null;
  instagramUrl: string | null;
  twitterUrl: string | null;
  youtubeUrl: string | null;
  followerCount: number;
}

export interface PublicEvent {
  id: string;
  name: string;
  startsAt: string;
  endsAt: string | null;
  venueName: string | null;
  city: string | null;
  thumbnailUrl: string | null;
  isSoldOut: boolean;
  minPriceHellers: number | null;
}

interface ProfileRow {
  id: string;
  name: string;
  slug: string | null;
  logo_url: string | null;
  cover_image_url: string | null;
  bio: string | null;
  website: string | null;
  facebook_url: string | null;
  instagram_url: string | null;
  twitter_url: string | null;
  youtube_url: string | null;
  is_profile_public: boolean;
  follower_count: string;
}

interface EventRow {
  id: string;
  name: string;
  starts_at: string;
  ends_at: string | null;
  venue_name: string | null;
  city: string | null;
  thumbnail_url: string | null;
  is_sold_out: boolean;
  min_price_hellers: string | null;
}

function mapProfile(r: ProfileRow): PromoterProfile {
  return {
    promoterId: r.id,
    name: r.name,
    slug: r.slug,
    logoUrl: r.logo_url,
    coverImageUrl: r.cover_image_url,
    bio: r.bio,
    website: r.website,
    facebookUrl: r.facebook_url,
    instagramUrl: r.instagram_url,
    twitterUrl: r.twitter_url,
    youtubeUrl: r.youtube_url,
    followerCount: Number(r.follower_count),
  };
}

/**
 * Get public profile for a promoter (by ID or slug).
 */
export async function getPublicProfile(
  promoterIdOrSlug: string,
  db: DbAdapter,
): Promise<PromoterProfile | null> {
  const rows = await db.query<ProfileRow>(
    `SELECT p.*,
       (SELECT COUNT(*) FROM promoters.promoter_followers f WHERE f.promoter_id = p.id) AS follower_count
     FROM promoters.promoters p
     WHERE (p.id = $1 OR p.slug = $1)
       AND p.is_profile_public = true`,
    [promoterIdOrSlug],
  );

  return rows[0] ? mapProfile(rows[0]) : null;
}

/**
 * Update the promoter's public profile fields.
 */
export async function updatePromoterProfile(
  promoterId: string,
  input: {
    bio?: string | null;
    coverImageUrl?: string | null;
    facebookUrl?: string | null;
    instagramUrl?: string | null;
    twitterUrl?: string | null;
    youtubeUrl?: string | null;
    isProfilePublic?: boolean;
  },
  db: DbAdapter,
): Promise<void> {
  // Validate URL fields if provided
  for (const field of ['facebookUrl', 'instagramUrl', 'twitterUrl', 'youtubeUrl', 'coverImageUrl'] as const) {
    const val = input[field];
    if (val && !val.startsWith('https://')) {
      throw new Error(`VALIDATION_ERROR: ${field} must start with https://`);
    }
  }

  await db.execute(
    `UPDATE promoters.promoters
     SET bio = COALESCE($2, bio),
         cover_image_url = COALESCE($3, cover_image_url),
         facebook_url = COALESCE($4, facebook_url),
         instagram_url = COALESCE($5, instagram_url),
         twitter_url = COALESCE($6, twitter_url),
         youtube_url = COALESCE($7, youtube_url),
         is_profile_public = COALESCE($8, is_profile_public),
         updated_at = NOW()
     WHERE id = $1`,
    [
      promoterId,
      input.bio ?? null,
      input.coverImageUrl ?? null,
      input.facebookUrl ?? null,
      input.instagramUrl ?? null,
      input.twitterUrl ?? null,
      input.youtubeUrl ?? null,
      input.isProfilePublic ?? null,
    ],
  );
}

/**
 * Get upcoming public events for a promoter profile.
 */
export async function getPromoterEvents(
  promoterIdOrSlug: string,
  filter: 'upcoming' | 'past' | 'all',
  db: DbAdapter,
): Promise<PublicEvent[]> {
  const dateFilter =
    filter === 'upcoming' ? `AND e.starts_at >= NOW()`
    : filter === 'past' ? `AND e.starts_at < NOW()`
    : '';

  const rows = await db.query<EventRow>(
    `SELECT
       e.id, e.name, e.starts_at, e.ends_at,
       v.name AS venue_name, v.city,
       e.thumbnail_url,
       (SELECT COUNT(*) FROM tickets.tickets t WHERE t.event_id = e.id AND t.status = 'active') >= e.capacity AS is_sold_out,
       (SELECT MIN(price_hellers) FROM catalog.ticket_types tt WHERE tt.event_id = e.id AND tt.status = 'active') AS min_price_hellers
     FROM catalog.events e
     JOIN promoters.promoters p ON p.id = e.promoter_id
     LEFT JOIN venues.venues v ON v.id = e.venue_id
     WHERE (p.id = $1 OR p.slug = $1)
       AND e.status = 'published'
       ${dateFilter}
     ORDER BY e.starts_at ${filter === 'past' ? 'DESC' : 'ASC'}
     LIMIT 50`,
    [promoterIdOrSlug],
  );

  return rows.map((r) => ({
    id: r.id,
    name: r.name,
    startsAt: r.starts_at,
    endsAt: r.ends_at,
    venueName: r.venue_name,
    city: r.city,
    thumbnailUrl: r.thumbnail_url,
    isSoldOut: r.is_sold_out,
    minPriceHellers: r.min_price_hellers !== null ? Number(r.min_price_hellers) : null,
  }));
}

/**
 * Follow a promoter to receive new event notifications.
 */
export async function followPromoter(
  promoterId: string,
  userId: string,
  notifyNewEvents: boolean,
  db: DbAdapter,
): Promise<void> {
  await db.execute(
    `INSERT INTO promoters.promoter_followers (promoter_id, user_id, notify_new_events)
     VALUES ($1, $2, $3)
     ON CONFLICT (promoter_id, user_id) DO UPDATE SET
       notify_new_events = EXCLUDED.notify_new_events,
       followed_at = NOW()`,
    [promoterId, userId, notifyNewEvents],
  );
}

/**
 * Unfollow a promoter.
 */
export async function unfollowPromoter(
  promoterId: string,
  userId: string,
  db: DbAdapter,
): Promise<void> {
  await db.execute(
    `DELETE FROM promoters.promoter_followers WHERE promoter_id = $1 AND user_id = $2`,
    [promoterId, userId],
  );
}

/**
 * Check if a user follows a promoter.
 */
export async function isFollowing(
  promoterId: string,
  userId: string,
  db: DbAdapter,
): Promise<boolean> {
  const rows = await db.query<{ found: boolean }>(
    `SELECT EXISTS(
       SELECT 1 FROM promoters.promoter_followers
       WHERE promoter_id = $1 AND user_id = $2
     ) AS found`,
    [promoterId, userId],
  );
  return rows[0]?.found ?? false;
}

/**
 * Get list of promoters a user follows (for their personalized feed).
 */
export async function getUserFollowedPromoters(
  userId: string,
  db: DbAdapter,
): Promise<Array<{ promoterId: string; name: string; slug: string | null; logoUrl: string | null }>> {
  const rows = await db.query<{ id: string; name: string; slug: string | null; logo_url: string | null }>(
    `SELECT p.id, p.name, p.slug, p.logo_url
     FROM promoters.promoter_followers f
     JOIN promoters.promoters p ON p.id = f.promoter_id
     WHERE f.user_id = $1
     ORDER BY f.followed_at DESC`,
    [userId],
  );

  return rows.map((r) => ({
    promoterId: r.id,
    name: r.name,
    slug: r.slug,
    logoUrl: r.logo_url,
  }));
}
