import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  followEntity,
  unfollowEntity,
  updateNotificationPreference,
  getUserFollows,
  getFollowsByType,
  notifyFollowers,
  importFromSpotify,
  importFromAppleMusic,
  getFollowStats,
} from '../services/artist-follows.service.js';
import { ArtistFollowsError } from '../types/artist-follows.types.js';
import type {
  ServiceDeps,
  FollowInput,
  NewEventPayload,
} from '../types/artist-follows.types.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeFollowRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'follow-1',
    user_id: 'user-1',
    followable_type: 'artist',
    followable_id: 'artist-1',
    followable_name: 'The Prodigy',
    notification_channel: 'both',
    import_source: 'manual',
    created_at: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

function makeDeps(overrides: Partial<ServiceDeps> = {}): ServiceDeps {
  return {
    db: {
      query: vi.fn(),
      execute: vi.fn(),
      transaction: vi.fn(fn => fn(makeDeps(overrides).db)),
    },
    notifications: {
      sendPush: vi.fn().mockResolvedValue(undefined),
      sendEmail: vi.fn().mockResolvedValue(undefined),
    },
    spotify: {
      getFollowedArtists: vi.fn(),
    },
    appleMusic: {
      getFollowedArtists: vi.fn(),
    },
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// followEntity
// ---------------------------------------------------------------------------

describe('followEntity', () => {
  it('creates a follow for an artist', async () => {
    const deps = makeDeps();
    const row = makeFollowRow();
    (deps.db.query as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce([])   // duplicate check
      .mockResolvedValueOnce([row]); // insert

    const input: FollowInput = {
      userId: 'user-1',
      followableType: 'artist',
      followableId: 'artist-1',
      followableName: 'The Prodigy',
    };
    const result = await followEntity(input, deps);

    expect(result.id).toBe('follow-1');
    expect(result.followableType).toBe('artist');
    expect(result.notificationChannel).toBe('both');
    expect(result.importSource).toBe('manual');
  });

  it('creates a follow for a venue', async () => {
    const deps = makeDeps();
    const row = makeFollowRow({ followable_type: 'venue', followable_id: 'venue-1', followable_name: 'O2 Arena' });
    (deps.db.query as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([row]);

    const result = await followEntity(
      { userId: 'user-1', followableType: 'venue', followableId: 'venue-1', followableName: 'O2 Arena' },
      deps,
    );
    expect(result.followableType).toBe('venue');
    expect(result.followableName).toBe('O2 Arena');
  });

  it('creates a follow for an organizer', async () => {
    const deps = makeDeps();
    const row = makeFollowRow({ followable_type: 'organizer', followable_id: 'org-1', followable_name: 'Live Nation' });
    (deps.db.query as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([row]);

    const result = await followEntity(
      { userId: 'user-1', followableType: 'organizer', followableId: 'org-1', followableName: 'Live Nation' },
      deps,
    );
    expect(result.followableType).toBe('organizer');
  });

  it('throws ALREADY_FOLLOWING when duplicate', async () => {
    const deps = makeDeps();
    (deps.db.query as ReturnType<typeof vi.fn>).mockResolvedValue([makeFollowRow()]);

    const input: FollowInput = {
      userId: 'user-1',
      followableType: 'artist',
      followableId: 'artist-1',
      followableName: 'The Prodigy',
    };

    await expect(followEntity(input, deps)).rejects.toThrow(ArtistFollowsError);
    await expect(followEntity(input, deps)).rejects.toMatchObject({ code: 'ALREADY_FOLLOWING' });
  });
});

// ---------------------------------------------------------------------------
// unfollowEntity
// ---------------------------------------------------------------------------

describe('unfollowEntity', () => {
  it('deletes an existing follow', async () => {
    const deps = makeDeps();
    (deps.db.query as ReturnType<typeof vi.fn>).mockResolvedValueOnce([makeFollowRow()]);
    (deps.db.execute as ReturnType<typeof vi.fn>).mockResolvedValueOnce(undefined);

    await expect(unfollowEntity('user-1', 'artist', 'artist-1', deps)).resolves.toBeUndefined();
    expect(deps.db.execute).toHaveBeenCalledOnce();
  });

  it('throws FOLLOW_NOT_FOUND when follow does not exist', async () => {
    const deps = makeDeps();
    (deps.db.query as ReturnType<typeof vi.fn>).mockResolvedValueOnce([]);

    await expect(unfollowEntity('user-1', 'artist', 'artist-99', deps)).rejects.toMatchObject({
      code: 'FOLLOW_NOT_FOUND',
    });
  });
});

// ---------------------------------------------------------------------------
// updateNotificationPreference
// ---------------------------------------------------------------------------

describe('updateNotificationPreference', () => {
  it('updates notification channel and returns updated follow', async () => {
    const deps = makeDeps();
    const updated = makeFollowRow({ notification_channel: 'email' });
    (deps.db.query as ReturnType<typeof vi.fn>).mockResolvedValueOnce([updated]);

    const result = await updateNotificationPreference('user-1', 'artist', 'artist-1', 'email', deps);
    expect(result.notificationChannel).toBe('email');
  });

  it('throws FOLLOW_NOT_FOUND when follow does not exist', async () => {
    const deps = makeDeps();
    (deps.db.query as ReturnType<typeof vi.fn>).mockResolvedValueOnce([]);

    await expect(
      updateNotificationPreference('user-1', 'artist', 'artist-99', 'push', deps),
    ).rejects.toMatchObject({ code: 'FOLLOW_NOT_FOUND' });
  });
});

// ---------------------------------------------------------------------------
// getUserFollows
// ---------------------------------------------------------------------------

describe('getUserFollows', () => {
  it('returns all follows sorted by createdAt DESC (most recent first)', async () => {
    const deps = makeDeps();
    const rows = [
      makeFollowRow({ id: 'f2', created_at: '2026-03-01T00:00:00.000Z' }),
      makeFollowRow({ id: 'f1', created_at: '2026-01-01T00:00:00.000Z' }),
    ];
    (deps.db.query as ReturnType<typeof vi.fn>).mockResolvedValueOnce(rows);

    const result = await getUserFollows('user-1', deps);
    expect(result).toHaveLength(2);
    expect(result[0]?.id).toBe('f2');
    expect(result[1]?.id).toBe('f1');
  });

  it('returns empty array when user has no follows', async () => {
    const deps = makeDeps();
    (deps.db.query as ReturnType<typeof vi.fn>).mockResolvedValueOnce([]);

    const result = await getUserFollows('user-1', deps);
    expect(result).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// getFollowsByType
// ---------------------------------------------------------------------------

describe('getFollowsByType', () => {
  it('returns only follows matching the given type', async () => {
    const deps = makeDeps();
    const rows = [
      makeFollowRow({ followable_type: 'venue', followable_id: 'v1' }),
      makeFollowRow({ followable_type: 'venue', followable_id: 'v2' }),
    ];
    (deps.db.query as ReturnType<typeof vi.fn>).mockResolvedValueOnce(rows);

    const result = await getFollowsByType('user-1', 'venue', deps);
    expect(result).toHaveLength(2);
    expect(result.every(f => f.followableType === 'venue')).toBe(true);
  });

  it('returns empty array when no follows of that type', async () => {
    const deps = makeDeps();
    (deps.db.query as ReturnType<typeof vi.fn>).mockResolvedValueOnce([]);

    const result = await getFollowsByType('user-1', 'organizer', deps);
    expect(result).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// notifyFollowers
// ---------------------------------------------------------------------------

describe('notifyFollowers', () => {
  const basePayload: NewEventPayload = {
    eventId: 'event-1',
    eventTitle: 'Rock Night 2026',
    eventDate: new Date('2026-06-15T20:00:00Z'),
    ticketUrl: 'https://tickets.example.com/event-1',
  };

  it('notifies artist followers when artistId provided', async () => {
    const deps = makeDeps();
    const followers = [makeFollowRow({ user_id: 'u1', notification_channel: 'both' })];
    (deps.db.query as ReturnType<typeof vi.fn>).mockResolvedValueOnce(followers);

    const result = await notifyFollowers({ ...basePayload, artistId: 'artist-1' }, deps);

    expect(result.notified).toBe(1);
    expect(result.pushSent).toBe(1);
    expect(result.emailSent).toBe(1);
    expect(deps.notifications.sendPush).toHaveBeenCalledWith('u1', expect.objectContaining({ title: expect.any(String) }));
    expect(deps.notifications.sendEmail).toHaveBeenCalledWith('u1', expect.objectContaining({ subject: expect.any(String) }));
  });

  it('notifies venue followers when venueId provided', async () => {
    const deps = makeDeps();
    const followers = [makeFollowRow({ user_id: 'u2', followable_type: 'venue', notification_channel: 'both' })];
    (deps.db.query as ReturnType<typeof vi.fn>).mockResolvedValueOnce(followers);

    const result = await notifyFollowers({ ...basePayload, venueId: 'venue-1' }, deps);
    expect(result.notified).toBe(1);
  });

  it('sends only push when channel is push', async () => {
    const deps = makeDeps();
    (deps.db.query as ReturnType<typeof vi.fn>).mockResolvedValueOnce([
      makeFollowRow({ notification_channel: 'push' }),
    ]);

    const result = await notifyFollowers({ ...basePayload, artistId: 'artist-1' }, deps);
    expect(result.pushSent).toBe(1);
    expect(result.emailSent).toBe(0);
    expect(deps.notifications.sendPush).toHaveBeenCalledOnce();
    expect(deps.notifications.sendEmail).not.toHaveBeenCalled();
  });

  it('sends only email when channel is email', async () => {
    const deps = makeDeps();
    (deps.db.query as ReturnType<typeof vi.fn>).mockResolvedValueOnce([
      makeFollowRow({ notification_channel: 'email' }),
    ]);

    const result = await notifyFollowers({ ...basePayload, artistId: 'artist-1' }, deps);
    expect(result.pushSent).toBe(0);
    expect(result.emailSent).toBe(1);
    expect(deps.notifications.sendEmail).toHaveBeenCalledOnce();
    expect(deps.notifications.sendPush).not.toHaveBeenCalled();
  });

  it('skips followers with channel none', async () => {
    const deps = makeDeps();
    // DB query already filters out 'none', so returns empty array
    (deps.db.query as ReturnType<typeof vi.fn>).mockResolvedValueOnce([]);

    const result = await notifyFollowers({ ...basePayload, artistId: 'artist-1' }, deps);
    expect(result.notified).toBe(0);
    expect(result.pushSent).toBe(0);
    expect(result.emailSent).toBe(0);
  });

  it('returns correct counts for multiple followers with mixed channels', async () => {
    const deps = makeDeps();
    (deps.db.query as ReturnType<typeof vi.fn>).mockResolvedValueOnce([
      makeFollowRow({ id: 'f1', user_id: 'u1', notification_channel: 'both' }),
      makeFollowRow({ id: 'f2', user_id: 'u2', notification_channel: 'push' }),
      makeFollowRow({ id: 'f3', user_id: 'u3', notification_channel: 'email' }),
    ]);

    const result = await notifyFollowers({ ...basePayload, artistId: 'artist-1' }, deps);
    expect(result.notified).toBe(3);
    expect(result.pushSent).toBe(2);  // u1 (both) + u2 (push)
    expect(result.emailSent).toBe(2); // u1 (both) + u3 (email)
  });

  it('returns zeros when no targets in payload', async () => {
    const deps = makeDeps();
    const result = await notifyFollowers(basePayload, deps);
    expect(result).toEqual({ notified: 0, pushSent: 0, emailSent: 0 });
    expect(deps.db.query).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// importFromSpotify
// ---------------------------------------------------------------------------

describe('importFromSpotify', () => {
  it('imports new artists from Spotify', async () => {
    const deps = makeDeps();
    (deps.spotify.getFollowedArtists as ReturnType<typeof vi.fn>).mockResolvedValueOnce([
      { spotifyId: 'sp-1', name: 'Artist A', genres: ['rock'], imageUrl: null },
      { spotifyId: 'sp-2', name: 'Artist B', genres: ['pop'], imageUrl: 'https://img.example.com/b.jpg' },
    ]);
    // Two successful inserts: duplicate check returns [], insert returns row
    (deps.db.query as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce([]).mockResolvedValueOnce([makeFollowRow({ followable_id: 'sp-1' })])
      .mockResolvedValueOnce([]).mockResolvedValueOnce([makeFollowRow({ followable_id: 'sp-2' })]);

    const result = await importFromSpotify('user-1', 'token-xyz', deps);
    expect(result.imported).toBe(2);
    expect(result.skipped).toBe(0);
  });

  it('skips already-followed artists (duplicates)', async () => {
    const deps = makeDeps();
    (deps.spotify.getFollowedArtists as ReturnType<typeof vi.fn>).mockResolvedValueOnce([
      { spotifyId: 'sp-1', name: 'Existing Artist', genres: [], imageUrl: null },
    ]);
    // duplicate check returns a row → ALREADY_FOLLOWING
    (deps.db.query as ReturnType<typeof vi.fn>).mockResolvedValueOnce([makeFollowRow()]);

    const result = await importFromSpotify('user-1', 'token-xyz', deps);
    expect(result.imported).toBe(0);
    expect(result.skipped).toBe(1);
  });

  it('correctly mixes imported and skipped', async () => {
    const deps = makeDeps();
    (deps.spotify.getFollowedArtists as ReturnType<typeof vi.fn>).mockResolvedValueOnce([
      { spotifyId: 'sp-1', name: 'New Artist', genres: [], imageUrl: null },
      { spotifyId: 'sp-2', name: 'Existing Artist', genres: [], imageUrl: null },
    ]);
    (deps.db.query as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce([])   // sp-1: no duplicate
      .mockResolvedValueOnce([makeFollowRow({ followable_id: 'sp-1' })])  // sp-1: insert
      .mockResolvedValueOnce([makeFollowRow()]); // sp-2: duplicate found

    const result = await importFromSpotify('user-1', 'token-xyz', deps);
    expect(result.imported).toBe(1);
    expect(result.skipped).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// importFromAppleMusic
// ---------------------------------------------------------------------------

describe('importFromAppleMusic', () => {
  it('imports new artists from Apple Music', async () => {
    const deps = makeDeps();
    (deps.appleMusic.getFollowedArtists as ReturnType<typeof vi.fn>).mockResolvedValueOnce([
      { appleMusicId: 'am-1', name: 'Apple Artist' },
    ]);
    (deps.db.query as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([makeFollowRow({ followable_id: 'am-1', import_source: 'apple_music' })]);

    const result = await importFromAppleMusic('user-1', 'am-token', deps);
    expect(result.imported).toBe(1);
    expect(result.skipped).toBe(0);
  });

  it('skips duplicate Apple Music artists', async () => {
    const deps = makeDeps();
    (deps.appleMusic.getFollowedArtists as ReturnType<typeof vi.fn>).mockResolvedValueOnce([
      { appleMusicId: 'am-1', name: 'Already Followed' },
    ]);
    (deps.db.query as ReturnType<typeof vi.fn>).mockResolvedValueOnce([makeFollowRow()]);

    const result = await importFromAppleMusic('user-1', 'am-token', deps);
    expect(result.imported).toBe(0);
    expect(result.skipped).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// getFollowStats
// ---------------------------------------------------------------------------

describe('getFollowStats', () => {
  it('returns correct follower counts', async () => {
    const deps = makeDeps();
    (deps.db.query as ReturnType<typeof vi.fn>).mockResolvedValueOnce([
      { follower_count: '5', push_subscribers: '3', email_subscribers: '4' },
    ]);

    const result = await getFollowStats('artist', 'artist-1', deps);
    expect(result.followerCount).toBe(5);
    expect(result.pushSubscribers).toBe(3);
    expect(result.emailSubscribers).toBe(4);
    expect(result.followableId).toBe('artist-1');
    expect(result.followableType).toBe('artist');
  });

  it('returns zeros when no followers', async () => {
    const deps = makeDeps();
    (deps.db.query as ReturnType<typeof vi.fn>).mockResolvedValueOnce([
      { follower_count: '0', push_subscribers: '0', email_subscribers: '0' },
    ]);

    const result = await getFollowStats('venue', 'venue-99', deps);
    expect(result.followerCount).toBe(0);
    expect(result.pushSubscribers).toBe(0);
    expect(result.emailSubscribers).toBe(0);
  });
});
