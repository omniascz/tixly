// =============================================================================
// Fan Social Graph — Feature #188
//
// Sociální vrstva pro kupující: friend graph, activity feed, sociální discovery.
// Doplňuje #65 (artist-follows) — fanoušek↔fanoušek.
//
// SCHEMA: social_graph.* (migration 167)
// =============================================================================

import {
  type Activity,
  type ActivityType,
  type DiscoverySuggestion,
  type EventSocialContext,
  type FeedItem,
  type FriendRequest,
  type FriendRequestStatus,
  type Friendship,
  type RecordActivityInput,
  type SendFriendRequestInput,
  type ServiceDeps,
  type UpsertProfileInput,
  type UserProfile,
  type Visibility,
  FanSocialGraphError,
} from '../types/fan-social-graph.types.js';

// ---------------------------------------------------------------------------
// Row mappers
// ---------------------------------------------------------------------------

interface ProfileRow {
  user_id: string;
  display_name: string;
  avatar_url: string | null;
  profile_visibility: string;
  activity_visibility: string;
  allow_friend_requests: boolean;
  created_at: string;
  updated_at: string;
}

function mapProfile(row: ProfileRow): UserProfile {
  return {
    userId: row.user_id,
    displayName: row.display_name,
    avatarUrl: row.avatar_url,
    profileVisibility: row.profile_visibility as Visibility,
    activityVisibility: row.activity_visibility as Visibility,
    allowFriendRequests: row.allow_friend_requests,
    createdAt: new Date(row.created_at),
    updatedAt: new Date(row.updated_at),
  };
}

interface RequestRow {
  id: string;
  from_user_id: string;
  to_user_id: string;
  status: string;
  message: string | null;
  created_at: string;
  responded_at: string | null;
}

function mapRequest(row: RequestRow): FriendRequest {
  return {
    id: row.id,
    fromUserId: row.from_user_id,
    toUserId: row.to_user_id,
    status: row.status as FriendRequestStatus,
    message: row.message,
    createdAt: new Date(row.created_at),
    respondedAt: row.responded_at ? new Date(row.responded_at) : null,
  };
}

interface FriendshipRow {
  user_a: string;
  user_b: string;
  created_at: string;
}

function mapFriendship(row: FriendshipRow): Friendship {
  return {
    userA: row.user_a,
    userB: row.user_b,
    createdAt: new Date(row.created_at),
  };
}

interface ActivityRow {
  id: string;
  user_id: string;
  activity_type: string;
  event_id: string;
  event_title: string;
  event_starts_at: string;
  visibility: string;
  metadata: Record<string, unknown> | null;
  created_at: string;
}

function mapActivity(row: ActivityRow): Activity {
  return {
    id: row.id,
    userId: row.user_id,
    activityType: row.activity_type as ActivityType,
    eventId: row.event_id,
    eventTitle: row.event_title,
    eventStartsAt: new Date(row.event_starts_at),
    visibility: row.visibility as Visibility,
    metadata: row.metadata,
    createdAt: new Date(row.created_at),
  };
}

// Kanonické pořadí dvou ID — friendships PK vyžaduje user_a < user_b.
function canonical(a: string, b: string): [string, string] {
  return a < b ? [a, b] : [b, a];
}

// ---------------------------------------------------------------------------
// Profile
// ---------------------------------------------------------------------------

/**
 * Vytvoří nebo zaktualizuje profil. Privacy defaulty: profile=public, activity=friends.
 */
export async function upsertProfile(
  input: UpsertProfileInput,
  deps: ServiceDeps,
): Promise<UserProfile> {
  const { db } = deps;
  const profileVisibility = input.profileVisibility ?? 'public';
  const activityVisibility = input.activityVisibility ?? 'friends';
  const allowFriendRequests = input.allowFriendRequests ?? true;
  const avatarUrl = input.avatarUrl ?? null;

  const rows = await db.query<ProfileRow>(
    `INSERT INTO social_graph.user_profiles
       (user_id, display_name, avatar_url, profile_visibility, activity_visibility, allow_friend_requests)
     VALUES ($1, $2, $3, $4, $5, $6)
     ON CONFLICT (user_id) DO UPDATE SET
       display_name = EXCLUDED.display_name,
       avatar_url = EXCLUDED.avatar_url,
       profile_visibility = EXCLUDED.profile_visibility,
       activity_visibility = EXCLUDED.activity_visibility,
       allow_friend_requests = EXCLUDED.allow_friend_requests,
       updated_at = NOW()
     RETURNING *`,
    [
      input.userId,
      input.displayName,
      avatarUrl,
      profileVisibility,
      activityVisibility,
      allowFriendRequests,
    ],
  );

  if (!rows[0]) throw new Error('INTERNAL_ERROR: profile upsert failed');
  return mapProfile(rows[0]);
}

export async function getProfile(
  userId: string,
  deps: ServiceDeps,
): Promise<UserProfile | null> {
  const { db } = deps;
  const rows = await db.query<ProfileRow>(
    `SELECT * FROM social_graph.user_profiles WHERE user_id = $1`,
    [userId],
  );
  return rows[0] ? mapProfile(rows[0]) : null;
}

// ---------------------------------------------------------------------------
// Friend requests
// ---------------------------------------------------------------------------

/**
 * Pošli žádost o přátelství.
 *  - sebe-friend → CANNOT_FRIEND_SELF
 *  - existující přátelství → ALREADY_FRIENDS
 *  - jakýkoli blok mezi A↔B → BLOCKED
 *  - příjemce má allow_friend_requests=false → REQUESTS_DISABLED
 *  - již existuje pending v daném směru → REQUEST_ALREADY_PENDING
 *  - existuje pending v opačném směru → auto-accept (vytvoří přátelství)
 */
export async function sendFriendRequest(
  input: SendFriendRequestInput,
  deps: ServiceDeps,
): Promise<FriendRequest> {
  const { db } = deps;

  if (input.fromUserId === input.toUserId) {
    throw new FanSocialGraphError('CANNOT_FRIEND_SELF', 'Cannot send friend request to self');
  }

  const [a, b] = canonical(input.fromUserId, input.toUserId);
  const existingFriendship = await db.query<FriendshipRow>(
    `SELECT * FROM social_graph.friendships WHERE user_a = $1 AND user_b = $2`,
    [a, b],
  );
  if (existingFriendship.length > 0) {
    throw new FanSocialGraphError('ALREADY_FRIENDS', 'Users are already friends');
  }

  const blocks = await db.query<{ user_id: string }>(
    `SELECT user_id FROM social_graph.blocks
     WHERE (user_id = $1 AND blocked_user_id = $2)
        OR (user_id = $2 AND blocked_user_id = $1)`,
    [input.fromUserId, input.toUserId],
  );
  if (blocks.length > 0) {
    throw new FanSocialGraphError('BLOCKED', 'A block exists between users');
  }

  const targetProfile = await db.query<ProfileRow>(
    `SELECT * FROM social_graph.user_profiles WHERE user_id = $1`,
    [input.toUserId],
  );
  if (targetProfile[0] && !targetProfile[0].allow_friend_requests) {
    throw new FanSocialGraphError(
      'REQUESTS_DISABLED',
      'Recipient does not accept friend requests',
    );
  }

  // Pokud existuje pending v opačném směru → auto-accept.
  const reverse = await db.query<RequestRow>(
    `SELECT * FROM social_graph.friend_requests
     WHERE from_user_id = $1 AND to_user_id = $2 AND status = 'pending'`,
    [input.toUserId, input.fromUserId],
  );
  if (reverse[0]) {
    return acceptFriendRequest(reverse[0].id, input.fromUserId, deps);
  }

  // Pokud existuje pending v tomto směru → REQUEST_ALREADY_PENDING.
  const same = await db.query<RequestRow>(
    `SELECT * FROM social_graph.friend_requests
     WHERE from_user_id = $1 AND to_user_id = $2 AND status = 'pending'`,
    [input.fromUserId, input.toUserId],
  );
  if (same.length > 0) {
    throw new FanSocialGraphError('REQUEST_ALREADY_PENDING', 'A pending request already exists');
  }

  const rows = await db.query<RequestRow>(
    `INSERT INTO social_graph.friend_requests (from_user_id, to_user_id, message)
     VALUES ($1, $2, $3)
     RETURNING *`,
    [input.fromUserId, input.toUserId, input.message ?? null],
  );

  if (!rows[0]) throw new Error('INTERNAL_ERROR: request insert failed');
  return mapRequest(rows[0]);
}

/**
 * Příjemce přijme žádost → vytvoří se friendship a request přejde na 'accepted'.
 */
export async function acceptFriendRequest(
  requestId: string,
  acceptingUserId: string,
  deps: ServiceDeps,
): Promise<FriendRequest> {
  const { db } = deps;

  return db.transaction(async tx => {
    const rows = await tx.query<RequestRow>(
      `SELECT * FROM social_graph.friend_requests WHERE id = $1`,
      [requestId],
    );
    const request = rows[0];
    if (!request) {
      throw new FanSocialGraphError('REQUEST_NOT_FOUND', 'Friend request not found');
    }
    if (request.to_user_id !== acceptingUserId) {
      throw new FanSocialGraphError(
        'NOT_AUTHORIZED',
        'Only the recipient can accept this request',
      );
    }
    if (request.status !== 'pending') {
      throw new FanSocialGraphError('REQUEST_NOT_FOUND', 'Request is no longer pending');
    }

    const [a, b] = canonical(request.from_user_id, request.to_user_id);
    await tx.execute(
      `INSERT INTO social_graph.friendships (user_a, user_b)
       VALUES ($1, $2)
       ON CONFLICT (user_a, user_b) DO NOTHING`,
      [a, b],
    );

    const updated = await tx.query<RequestRow>(
      `UPDATE social_graph.friend_requests
       SET status = 'accepted', responded_at = NOW()
       WHERE id = $1
       RETURNING *`,
      [requestId],
    );

    if (!updated[0]) throw new Error('INTERNAL_ERROR: request update failed');
    return mapRequest(updated[0]);
  });
}

export async function declineFriendRequest(
  requestId: string,
  decliningUserId: string,
  deps: ServiceDeps,
): Promise<FriendRequest> {
  const { db } = deps;

  const rows = await db.query<RequestRow>(
    `SELECT * FROM social_graph.friend_requests WHERE id = $1`,
    [requestId],
  );
  const request = rows[0];
  if (!request) {
    throw new FanSocialGraphError('REQUEST_NOT_FOUND', 'Friend request not found');
  }
  if (request.to_user_id !== decliningUserId) {
    throw new FanSocialGraphError(
      'NOT_AUTHORIZED',
      'Only the recipient can decline this request',
    );
  }
  if (request.status !== 'pending') {
    throw new FanSocialGraphError('REQUEST_NOT_FOUND', 'Request is no longer pending');
  }

  const updated = await db.query<RequestRow>(
    `UPDATE social_graph.friend_requests
     SET status = 'declined', responded_at = NOW()
     WHERE id = $1
     RETURNING *`,
    [requestId],
  );
  if (!updated[0]) throw new Error('INTERNAL_ERROR: decline failed');
  return mapRequest(updated[0]);
}

export async function cancelFriendRequest(
  requestId: string,
  cancellingUserId: string,
  deps: ServiceDeps,
): Promise<FriendRequest> {
  const { db } = deps;

  const rows = await db.query<RequestRow>(
    `SELECT * FROM social_graph.friend_requests WHERE id = $1`,
    [requestId],
  );
  const request = rows[0];
  if (!request) {
    throw new FanSocialGraphError('REQUEST_NOT_FOUND', 'Friend request not found');
  }
  if (request.from_user_id !== cancellingUserId) {
    throw new FanSocialGraphError(
      'NOT_AUTHORIZED',
      'Only the sender can cancel this request',
    );
  }
  if (request.status !== 'pending') {
    throw new FanSocialGraphError('REQUEST_NOT_FOUND', 'Request is no longer pending');
  }

  const updated = await db.query<RequestRow>(
    `UPDATE social_graph.friend_requests
     SET status = 'cancelled', responded_at = NOW()
     WHERE id = $1
     RETURNING *`,
    [requestId],
  );
  if (!updated[0]) throw new Error('INTERNAL_ERROR: cancel failed');
  return mapRequest(updated[0]);
}

export async function getIncomingRequests(
  userId: string,
  deps: ServiceDeps,
): Promise<FriendRequest[]> {
  const rows = await deps.db.query<RequestRow>(
    `SELECT * FROM social_graph.friend_requests
     WHERE to_user_id = $1 AND status = 'pending'
     ORDER BY created_at DESC`,
    [userId],
  );
  return rows.map(mapRequest);
}

export async function getOutgoingRequests(
  userId: string,
  deps: ServiceDeps,
): Promise<FriendRequest[]> {
  const rows = await deps.db.query<RequestRow>(
    `SELECT * FROM social_graph.friend_requests
     WHERE from_user_id = $1 AND status = 'pending'
     ORDER BY created_at DESC`,
    [userId],
  );
  return rows.map(mapRequest);
}

// ---------------------------------------------------------------------------
// Friendships
// ---------------------------------------------------------------------------

/** Odstraní přátelství v obou směrech. NOT_FRIENDS pokud neexistuje. */
export async function removeFriend(
  userId: string,
  friendId: string,
  deps: ServiceDeps,
): Promise<void> {
  const { db } = deps;
  const [a, b] = canonical(userId, friendId);

  const existing = await db.query<FriendshipRow>(
    `SELECT * FROM social_graph.friendships WHERE user_a = $1 AND user_b = $2`,
    [a, b],
  );
  if (existing.length === 0) {
    throw new FanSocialGraphError('NOT_FRIENDS', 'Friendship does not exist');
  }

  await db.execute(
    `DELETE FROM social_graph.friendships WHERE user_a = $1 AND user_b = $2`,
    [a, b],
  );
}

/** Vrátí seznam friend user_ids (druhá strana přátelství). */
export async function getFriends(
  userId: string,
  deps: ServiceDeps,
): Promise<string[]> {
  const rows = await deps.db.query<{ friend_id: string }>(
    `SELECT CASE WHEN user_a = $1 THEN user_b ELSE user_a END AS friend_id
     FROM social_graph.friendships
     WHERE user_a = $1 OR user_b = $1
     ORDER BY created_at DESC`,
    [userId],
  );
  return rows.map(r => r.friend_id);
}

export async function areFriends(
  userIdA: string,
  userIdB: string,
  deps: ServiceDeps,
): Promise<boolean> {
  if (userIdA === userIdB) return false;
  const [a, b] = canonical(userIdA, userIdB);
  const rows = await deps.db.query<{ user_a: string }>(
    `SELECT user_a FROM social_graph.friendships WHERE user_a = $1 AND user_b = $2`,
    [a, b],
  );
  return rows.length > 0;
}

/** Společní přátelé dvou uživatelů. */
export async function getMutualFriends(
  userIdA: string,
  userIdB: string,
  deps: ServiceDeps,
): Promise<string[]> {
  const [friendsA, friendsB] = await Promise.all([
    getFriends(userIdA, deps),
    getFriends(userIdB, deps),
  ]);
  const setB = new Set(friendsB);
  return friendsA.filter(id => setB.has(id));
}

// ---------------------------------------------------------------------------
// Blocks
// ---------------------------------------------------------------------------

/**
 * Zablokuje uživatele — odstraní přátelství i pending requesty v obou směrech.
 * Idempotentní: opakovaný blok přepíše timestamp.
 */
export async function blockUser(
  userId: string,
  blockedUserId: string,
  deps: ServiceDeps,
): Promise<void> {
  if (userId === blockedUserId) {
    throw new FanSocialGraphError('CANNOT_FRIEND_SELF', 'Cannot block self');
  }
  const { db } = deps;

  await db.transaction(async tx => {
    await tx.execute(
      `INSERT INTO social_graph.blocks (user_id, blocked_user_id)
       VALUES ($1, $2)
       ON CONFLICT (user_id, blocked_user_id) DO UPDATE SET created_at = NOW()`,
      [userId, blockedUserId],
    );

    const [a, b] = canonical(userId, blockedUserId);
    await tx.execute(
      `DELETE FROM social_graph.friendships WHERE user_a = $1 AND user_b = $2`,
      [a, b],
    );

    await tx.execute(
      `UPDATE social_graph.friend_requests
       SET status = 'cancelled', responded_at = NOW()
       WHERE status = 'pending'
         AND ((from_user_id = $1 AND to_user_id = $2)
           OR (from_user_id = $2 AND to_user_id = $1))`,
      [userId, blockedUserId],
    );
  });
}

export async function unblockUser(
  userId: string,
  blockedUserId: string,
  deps: ServiceDeps,
): Promise<void> {
  await deps.db.execute(
    `DELETE FROM social_graph.blocks WHERE user_id = $1 AND blocked_user_id = $2`,
    [userId, blockedUserId],
  );
}

export async function isBlocked(
  userId: string,
  otherUserId: string,
  deps: ServiceDeps,
): Promise<boolean> {
  const rows = await deps.db.query<{ user_id: string }>(
    `SELECT user_id FROM social_graph.blocks
     WHERE (user_id = $1 AND blocked_user_id = $2)
        OR (user_id = $2 AND blocked_user_id = $1)`,
    [userId, otherUserId],
  );
  return rows.length > 0;
}

// ---------------------------------------------------------------------------
// Activities & feed
// ---------------------------------------------------------------------------

/**
 * Zaznamenej aktivitu (plánuju jít, jdu, byl jsem). Idempotentní per (user, event, type).
 */
export async function recordActivity(
  input: RecordActivityInput,
  deps: ServiceDeps,
): Promise<Activity> {
  const visibility = input.visibility ?? 'friends';
  const metadata = input.metadata ?? null;

  const rows = await deps.db.query<ActivityRow>(
    `INSERT INTO social_graph.activities
       (user_id, activity_type, event_id, event_title, event_starts_at, visibility, metadata)
     VALUES ($1, $2, $3, $4, $5, $6, $7)
     ON CONFLICT (user_id, event_id, activity_type) DO UPDATE SET
       event_title = EXCLUDED.event_title,
       event_starts_at = EXCLUDED.event_starts_at,
       visibility = EXCLUDED.visibility,
       metadata = EXCLUDED.metadata
     RETURNING *`,
    [
      input.userId,
      input.activityType,
      input.eventId,
      input.eventTitle,
      input.eventStartsAt.toISOString(),
      visibility,
      metadata,
    ],
  );

  if (!rows[0]) throw new Error('INTERNAL_ERROR: activity insert failed');
  return mapActivity(rows[0]);
}

/**
 * Activity feed pro uživatele: aktivity přátel, kde visibility != 'private',
 * řazené od nejnovějších. Bloky vyloučeny.
 */
export async function getActivityFeed(
  userId: string,
  deps: ServiceDeps,
  options: { limit?: number; sinceCreatedAt?: Date } = {},
): Promise<FeedItem[]> {
  const limit = options.limit ?? 50;
  const sinceFilter = options.sinceCreatedAt
    ? `AND a.created_at > '${options.sinceCreatedAt.toISOString()}'`
    : '';

  const rows = await deps.db.query<ActivityRow & { display_name: string; avatar_url: string | null }>(
    `SELECT a.*,
            COALESCE(p.display_name, 'Friend') AS display_name,
            p.avatar_url
     FROM social_graph.activities a
     JOIN social_graph.friendships f
       ON (f.user_a = $1 AND f.user_b = a.user_id)
       OR (f.user_b = $1 AND f.user_a = a.user_id)
     LEFT JOIN social_graph.user_profiles p ON p.user_id = a.user_id
     WHERE a.visibility IN ('public', 'friends')
       AND NOT EXISTS (
         SELECT 1 FROM social_graph.blocks b
         WHERE (b.user_id = $1 AND b.blocked_user_id = a.user_id)
            OR (b.user_id = a.user_id AND b.blocked_user_id = $1)
       )
       ${sinceFilter}
     ORDER BY a.created_at DESC
     LIMIT ${limit}`,
    [userId],
  );

  return rows.map(row => ({
    ...mapActivity(row),
    actorDisplayName: row.display_name,
    actorAvatarUrl: row.avatar_url,
  }));
}

/**
 * „Petr a 3 přátelé plánují jít na X" — sociální kontext jedné akce.
 */
export async function getEventSocialContext(
  userId: string,
  eventId: string,
  deps: ServiceDeps,
): Promise<EventSocialContext> {
  const rows = await deps.db.query<{
    user_id: string;
    display_name: string | null;
    avatar_url: string | null;
  }>(
    `SELECT DISTINCT a.user_id,
            p.display_name,
            p.avatar_url
     FROM social_graph.activities a
     JOIN social_graph.friendships f
       ON (f.user_a = $1 AND f.user_b = a.user_id)
       OR (f.user_b = $1 AND f.user_a = a.user_id)
     LEFT JOIN social_graph.user_profiles p ON p.user_id = a.user_id
     WHERE a.event_id = $2
       AND a.activity_type IN ('planning_to_attend', 'attending', 'attended')
       AND a.visibility IN ('public', 'friends')
     ORDER BY a.user_id`,
    [userId, eventId],
  );

  const friends = rows.map(r => ({
    userId: r.user_id,
    displayName: r.display_name ?? 'Friend',
    avatarUrl: r.avatar_url,
  }));

  return {
    eventId,
    friendsAttending: friends,
    totalFriends: friends.length,
    summary: buildSocialSummary(friends),
  };
}

function buildSocialSummary(
  friends: Array<{ userId: string; displayName: string; avatarUrl: string | null }>,
): string {
  if (friends.length === 0) return 'Žádný z přátel zatím neplánuje jít.';
  const first = friends[0];
  if (!first) return 'Žádný z přátel zatím neplánuje jít.';
  if (friends.length === 1) return `${first.displayName} plánuje jít.`;
  if (friends.length === 2) {
    const second = friends[1]!;
    return `${first.displayName} a ${second.displayName} plánují jít.`;
  }
  return `${first.displayName} a ${friends.length - 1} přátelé plánují jít.`;
}

/**
 * „Co dělají přátelé tento víkend" — agregace nadcházejících akcí, kde má
 * aspoň jeden přítel uživatele aktivitu typu plánuji/jdu.
 */
export async function getDiscovery(
  userId: string,
  rangeStart: Date,
  rangeEnd: Date,
  deps: ServiceDeps,
  options: { limit?: number } = {},
): Promise<DiscoverySuggestion[]> {
  const limit = options.limit ?? 20;

  const rows = await deps.db.query<{
    event_id: string;
    event_title: string;
    event_starts_at: string;
    friend_count: string;
    sample_user_ids: string[];
    sample_display_names: Array<string | null>;
  }>(
    `WITH friend_activities AS (
       SELECT a.event_id,
              a.event_title,
              a.event_starts_at,
              a.user_id,
              p.display_name
       FROM social_graph.activities a
       JOIN social_graph.friendships f
         ON (f.user_a = $1 AND f.user_b = a.user_id)
         OR (f.user_b = $1 AND f.user_a = a.user_id)
       LEFT JOIN social_graph.user_profiles p ON p.user_id = a.user_id
       WHERE a.activity_type IN ('planning_to_attend', 'attending')
         AND a.visibility IN ('public', 'friends')
         AND a.event_starts_at >= $2
         AND a.event_starts_at <= $3
     )
     SELECT event_id,
            MAX(event_title) AS event_title,
            MIN(event_starts_at) AS event_starts_at,
            COUNT(DISTINCT user_id)::TEXT AS friend_count,
            ARRAY_AGG(DISTINCT user_id) AS sample_user_ids,
            ARRAY_AGG(DISTINCT display_name) AS sample_display_names
     FROM friend_activities
     GROUP BY event_id
     ORDER BY COUNT(DISTINCT user_id) DESC, MIN(event_starts_at) ASC
     LIMIT ${limit}`,
    [userId, rangeStart.toISOString(), rangeEnd.toISOString()],
  );

  return rows.map(row => {
    const ids = row.sample_user_ids.slice(0, 3);
    const names = row.sample_display_names.slice(0, 3);
    return {
      eventId: row.event_id,
      eventTitle: row.event_title,
      eventStartsAt: new Date(row.event_starts_at),
      friendCount: parseInt(row.friend_count, 10) || 0,
      sampleFriends: ids.map((id, i) => ({
        userId: id,
        displayName: names[i] ?? 'Friend',
      })),
    };
  });
}

/** Označí feed za přečtený k danému okamžiku. */
export async function markFeedRead(
  userId: string,
  deps: ServiceDeps,
): Promise<void> {
  await deps.db.execute(
    `INSERT INTO social_graph.feed_views (user_id, last_viewed_at)
     VALUES ($1, NOW())
     ON CONFLICT (user_id) DO UPDATE SET last_viewed_at = NOW()`,
    [userId],
  );
}
