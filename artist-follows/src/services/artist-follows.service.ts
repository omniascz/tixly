// =============================================================================
// Artist Follows & Notifications — Feature #65
//
// Fanoušek označí oblíbeného umělce nebo venue → automatický push/email
// při nové akci. Import z Spotify nebo Apple Music.
//
// SCHEMA: follows.* (migration 165)
// =============================================================================

import type {
  Follow,
  FollowInput,
  FollowableType,
  NotificationChannel,
  NewEventPayload,
  FollowStats,
  ServiceDeps,
} from '../types/artist-follows.types.js';
import { ArtistFollowsError } from '../types/artist-follows.types.js';

interface FollowRow {
  id: string;
  user_id: string;
  followable_type: string;
  followable_id: string;
  followable_name: string;
  notification_channel: string;
  import_source: string;
  created_at: string;
}

function mapFollow(row: FollowRow): Follow {
  return {
    id: row.id,
    userId: row.user_id,
    followableType: row.followable_type as FollowableType,
    followableId: row.followable_id,
    followableName: row.followable_name,
    notificationChannel: row.notification_channel as NotificationChannel,
    importSource: row.import_source as Follow['importSource'],
    createdAt: new Date(row.created_at),
  };
}

/**
 * Sleduj umělce, venue nebo organizátora.
 * Duplikát (userId + followableType + followableId) → ALREADY_FOLLOWING
 */
export async function followEntity(input: FollowInput, deps: ServiceDeps): Promise<Follow> {
  const { db } = deps;

  const existing = await db.query<FollowRow>(
    `SELECT id FROM follows.entity_follows
     WHERE user_id = $1 AND followable_type = $2 AND followable_id = $3`,
    [input.userId, input.followableType, input.followableId],
  );

  if (existing.length > 0) {
    throw new ArtistFollowsError('ALREADY_FOLLOWING', 'User is already following this entity');
  }

  const channel = input.notificationChannel ?? 'both';
  const source = input.importSource ?? 'manual';

  const rows = await db.query<FollowRow>(
    `INSERT INTO follows.entity_follows
       (user_id, followable_type, followable_id, followable_name, notification_channel, import_source)
     VALUES ($1, $2, $3, $4, $5, $6)
     RETURNING *`,
    [input.userId, input.followableType, input.followableId, input.followableName, channel, source],
  );

  if (!rows[0]) throw new Error('INTERNAL_ERROR: follow creation failed');
  return mapFollow(rows[0]);
}

/**
 * Přestaň sledovat entitu.
 * Pokud follow neexistuje → FOLLOW_NOT_FOUND
 */
export async function unfollowEntity(
  userId: string,
  followableType: FollowableType,
  followableId: string,
  deps: ServiceDeps,
): Promise<void> {
  const { db } = deps;

  const existing = await db.query<FollowRow>(
    `SELECT id FROM follows.entity_follows
     WHERE user_id = $1 AND followable_type = $2 AND followable_id = $3`,
    [userId, followableType, followableId],
  );

  if (existing.length === 0) {
    throw new ArtistFollowsError('FOLLOW_NOT_FOUND', 'Follow not found');
  }

  await db.execute(
    `DELETE FROM follows.entity_follows
     WHERE user_id = $1 AND followable_type = $2 AND followable_id = $3`,
    [userId, followableType, followableId],
  );
}

/**
 * Aktualizuj preferenci notifikačního kanálu pro daný follow.
 */
export async function updateNotificationPreference(
  userId: string,
  followableType: FollowableType,
  followableId: string,
  channel: NotificationChannel,
  deps: ServiceDeps,
): Promise<Follow> {
  const { db } = deps;

  const rows = await db.query<FollowRow>(
    `UPDATE follows.entity_follows
     SET notification_channel = $4
     WHERE user_id = $1 AND followable_type = $2 AND followable_id = $3
     RETURNING *`,
    [userId, followableType, followableId, channel],
  );

  if (!rows[0]) {
    throw new ArtistFollowsError('FOLLOW_NOT_FOUND', 'Follow not found');
  }

  return mapFollow(rows[0]);
}

/**
 * Vrátí všechny follows uživatele, seřazené by createdAt DESC.
 */
export async function getUserFollows(userId: string, deps: ServiceDeps): Promise<Follow[]> {
  const { db } = deps;

  const rows = await db.query<FollowRow>(
    `SELECT * FROM follows.entity_follows
     WHERE user_id = $1
     ORDER BY created_at DESC`,
    [userId],
  );

  return rows.map(mapFollow);
}

/**
 * Vrátí follows uživatele filtrované podle followableType.
 */
export async function getFollowsByType(
  userId: string,
  followableType: FollowableType,
  deps: ServiceDeps,
): Promise<Follow[]> {
  const { db } = deps;

  const rows = await db.query<FollowRow>(
    `SELECT * FROM follows.entity_follows
     WHERE user_id = $1 AND followable_type = $2
     ORDER BY created_at DESC`,
    [userId, followableType],
  );

  return rows.map(mapFollow);
}

/**
 * Notifikuj followery o nové akci.
 * Vrátí počty odeslání.
 */
export async function notifyFollowers(
  payload: NewEventPayload,
  deps: ServiceDeps,
): Promise<{ notified: number; pushSent: number; emailSent: number }> {
  const { db, notifications } = deps;

  // Sestav seznam (followableType, followableId) párů z payloadu
  const targets: Array<{ type: FollowableType; id: string }> = [];
  if (payload.artistId) targets.push({ type: 'artist', id: payload.artistId });
  if (payload.venueId) targets.push({ type: 'venue', id: payload.venueId });
  if (payload.organizerId) targets.push({ type: 'organizer', id: payload.organizerId });

  if (targets.length === 0) {
    return { notified: 0, pushSent: 0, emailSent: 0 };
  }

  // Načti všechny relevantní followery (notification_channel != 'none')
  // Použijeme OR podmínky pro každý pár
  const placeholders = targets
    .map((_, i) => `(followable_type = $${i * 2 + 1} AND followable_id = $${i * 2 + 2})`)
    .join(' OR ');
  const params: unknown[] = targets.flatMap(t => [t.type, t.id]);

  const rows = await db.query<FollowRow>(
    `SELECT * FROM follows.entity_follows
     WHERE (${placeholders}) AND notification_channel != 'none'`,
    params,
  );

  let pushSent = 0;
  let emailSent = 0;

  const notificationTitle = `Nová akce: ${payload.eventTitle}`;
  const notificationBody = `Přijď na ${payload.eventTitle} — kup si vstupenky!`;

  for (const row of rows) {
    const follow = mapFollow(row);
    const channel = follow.notificationChannel;

    if (channel === 'push' || channel === 'both') {
      await notifications.sendPush(follow.userId, {
        title: notificationTitle,
        body: notificationBody,
        data: {
          eventId: payload.eventId,
          ticketUrl: payload.ticketUrl,
        },
      });
      pushSent++;
    }

    if (channel === 'email' || channel === 'both') {
      await notifications.sendEmail(follow.userId, {
        subject: notificationTitle,
        templateId: 'new-event-notification',
        variables: {
          eventTitle: payload.eventTitle,
          eventDate: payload.eventDate.toISOString(),
          ticketUrl: payload.ticketUrl,
          followableName: follow.followableName,
        },
      });
      emailSent++;
    }
  }

  return {
    notified: rows.length,
    pushSent,
    emailSent,
  };
}

/**
 * Importuj sledované umělce ze Spotify.
 * Vrátí { imported, skipped } — skipped = duplicáty.
 */
export async function importFromSpotify(
  userId: string,
  accessToken: string,
  deps: ServiceDeps,
): Promise<{ imported: number; skipped: number }> {
  const { spotify } = deps;

  const artists = await spotify.getFollowedArtists(accessToken);

  let imported = 0;
  let skipped = 0;

  for (const artist of artists) {
    try {
      await followEntity(
        {
          userId,
          followableType: 'artist',
          followableId: artist.spotifyId,
          followableName: artist.name,
          importSource: 'spotify',
        },
        deps,
      );
      imported++;
    } catch (err) {
      if (err instanceof ArtistFollowsError && err.code === 'ALREADY_FOLLOWING') {
        skipped++;
      } else {
        throw err;
      }
    }
  }

  return { imported, skipped };
}

/**
 * Importuj sledované umělce z Apple Music.
 * Vrátí { imported, skipped } — skipped = duplicáty.
 */
export async function importFromAppleMusic(
  userId: string,
  userToken: string,
  deps: ServiceDeps,
): Promise<{ imported: number; skipped: number }> {
  const { appleMusic } = deps;

  const artists = await appleMusic.getFollowedArtists(userToken);

  let imported = 0;
  let skipped = 0;

  for (const artist of artists) {
    try {
      await followEntity(
        {
          userId,
          followableType: 'artist',
          followableId: artist.appleMusicId,
          followableName: artist.name,
          importSource: 'apple_music',
        },
        deps,
      );
      imported++;
    } catch (err) {
      if (err instanceof ArtistFollowsError && err.code === 'ALREADY_FOLLOWING') {
        skipped++;
      } else {
        throw err;
      }
    }
  }

  return { imported, skipped };
}

/**
 * Vrátí statistiky sledovatelů pro danou entitu.
 */
export async function getFollowStats(
  followableType: FollowableType,
  followableId: string,
  deps: ServiceDeps,
): Promise<FollowStats> {
  const { db } = deps;

  const rows = await db.query<{
    follower_count: string;
    push_subscribers: string;
    email_subscribers: string;
  }>(
    `SELECT
       COUNT(*) AS follower_count,
       SUM(CASE WHEN notification_channel IN ('push', 'both') THEN 1 ELSE 0 END) AS push_subscribers,
       SUM(CASE WHEN notification_channel IN ('email', 'both') THEN 1 ELSE 0 END) AS email_subscribers
     FROM follows.entity_follows
     WHERE followable_type = $1 AND followable_id = $2`,
    [followableType, followableId],
  );

  const row = rows[0];
  if (!row) {
    return {
      followableId,
      followableType,
      followerCount: 0,
      pushSubscribers: 0,
      emailSubscribers: 0,
    };
  }

  return {
    followableId,
    followableType,
    followerCount: parseInt(row.follower_count, 10) || 0,
    pushSubscribers: parseInt(row.push_subscribers, 10) || 0,
    emailSubscribers: parseInt(row.email_subscribers, 10) || 0,
  };
}
