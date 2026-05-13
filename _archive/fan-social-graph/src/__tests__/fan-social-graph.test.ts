import { describe, it, expect, vi } from 'vitest';
import {
  upsertProfile,
  getProfile,
  sendFriendRequest,
  acceptFriendRequest,
  declineFriendRequest,
  cancelFriendRequest,
  getIncomingRequests,
  getOutgoingRequests,
  removeFriend,
  getFriends,
  areFriends,
  getMutualFriends,
  blockUser,
  unblockUser,
  isBlocked,
  recordActivity,
  getActivityFeed,
  getEventSocialContext,
  getDiscovery,
  markFeedRead,
} from '../services/fan-social-graph.service.js';
import {
  FanSocialGraphError,
  type DbAdapter,
  type ServiceDeps,
} from '../types/fan-social-graph.types.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeDb(): DbAdapter {
  const db: DbAdapter = {
    query: vi.fn(),
    execute: vi.fn().mockResolvedValue(undefined),
    transaction: vi.fn(async fn => fn(db)),
  };
  return db;
}

function makeDeps(): ServiceDeps {
  return { db: makeDb() };
}

function makeProfileRow(overrides: Record<string, unknown> = {}) {
  return {
    user_id: 'user-1',
    display_name: 'Petr',
    avatar_url: null,
    profile_visibility: 'public',
    activity_visibility: 'friends',
    allow_friend_requests: true,
    created_at: '2026-01-01T00:00:00.000Z',
    updated_at: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

function makeRequestRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'req-1',
    from_user_id: 'user-1',
    to_user_id: 'user-2',
    status: 'pending',
    message: null,
    created_at: '2026-01-01T00:00:00.000Z',
    responded_at: null,
    ...overrides,
  };
}

function makeActivityRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'act-1',
    user_id: 'user-2',
    activity_type: 'planning_to_attend',
    event_id: 'event-1',
    event_title: 'The Prodigy',
    event_starts_at: '2026-05-01T19:00:00.000Z',
    visibility: 'friends',
    metadata: null,
    created_at: '2026-04-10T00:00:00.000Z',
    ...overrides,
  };
}

const q = (deps: ServiceDeps) => deps.db.query as ReturnType<typeof vi.fn>;
const e = (deps: ServiceDeps) => deps.db.execute as ReturnType<typeof vi.fn>;

// ---------------------------------------------------------------------------
// Profile
// ---------------------------------------------------------------------------

describe('upsertProfile', () => {
  it('creates a profile with defaults', async () => {
    const deps = makeDeps();
    q(deps).mockResolvedValueOnce([makeProfileRow()]);

    const result = await upsertProfile(
      { userId: 'user-1', displayName: 'Petr' },
      deps,
    );

    expect(result.userId).toBe('user-1');
    expect(result.profileVisibility).toBe('public');
    expect(result.activityVisibility).toBe('friends');
    expect(result.allowFriendRequests).toBe(true);
  });

  it('respects custom privacy settings', async () => {
    const deps = makeDeps();
    q(deps).mockResolvedValueOnce([
      makeProfileRow({
        profile_visibility: 'private',
        activity_visibility: 'private',
        allow_friend_requests: false,
      }),
    ]);

    const result = await upsertProfile(
      {
        userId: 'user-1',
        displayName: 'Petr',
        profileVisibility: 'private',
        activityVisibility: 'private',
        allowFriendRequests: false,
      },
      deps,
    );

    expect(result.profileVisibility).toBe('private');
    expect(result.allowFriendRequests).toBe(false);
  });
});

describe('getProfile', () => {
  it('returns null for missing profile', async () => {
    const deps = makeDeps();
    q(deps).mockResolvedValueOnce([]);
    const result = await getProfile('ghost', deps);
    expect(result).toBeNull();
  });

  it('returns mapped profile', async () => {
    const deps = makeDeps();
    q(deps).mockResolvedValueOnce([makeProfileRow({ display_name: 'Anna' })]);
    const result = await getProfile('user-1', deps);
    expect(result?.displayName).toBe('Anna');
  });
});

// ---------------------------------------------------------------------------
// Friend requests
// ---------------------------------------------------------------------------

describe('sendFriendRequest', () => {
  it('rejects self-friend', async () => {
    const deps = makeDeps();
    await expect(
      sendFriendRequest({ fromUserId: 'a', toUserId: 'a' }, deps),
    ).rejects.toMatchObject({ code: 'CANNOT_FRIEND_SELF' });
  });

  it('rejects when already friends', async () => {
    const deps = makeDeps();
    q(deps).mockResolvedValueOnce([{ user_a: 'a', user_b: 'b', created_at: '2026-01-01' }]);
    await expect(
      sendFriendRequest({ fromUserId: 'a', toUserId: 'b' }, deps),
    ).rejects.toMatchObject({ code: 'ALREADY_FRIENDS' });
  });

  it('rejects when blocked', async () => {
    const deps = makeDeps();
    q(deps)
      .mockResolvedValueOnce([])  // friendship check
      .mockResolvedValueOnce([{ user_id: 'b' }]);  // block check
    await expect(
      sendFriendRequest({ fromUserId: 'a', toUserId: 'b' }, deps),
    ).rejects.toMatchObject({ code: 'BLOCKED' });
  });

  it('rejects when recipient disabled requests', async () => {
    const deps = makeDeps();
    q(deps)
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([makeProfileRow({ allow_friend_requests: false, user_id: 'b' })]);
    await expect(
      sendFriendRequest({ fromUserId: 'a', toUserId: 'b' }, deps),
    ).rejects.toMatchObject({ code: 'REQUESTS_DISABLED' });
  });

  it('auto-accepts when reverse pending request exists', async () => {
    const deps = makeDeps();
    const reverseRequest = makeRequestRow({
      id: 'req-rev',
      from_user_id: 'b',
      to_user_id: 'a',
    });
    q(deps)
      .mockResolvedValueOnce([])  // friendship
      .mockResolvedValueOnce([])  // blocks
      .mockResolvedValueOnce([])  // target profile
      .mockResolvedValueOnce([reverseRequest])  // reverse pending
      // accept transaction:
      .mockResolvedValueOnce([reverseRequest])  // SELECT in accept
      .mockResolvedValueOnce([{ ...reverseRequest, status: 'accepted', responded_at: '2026-01-01' }]);

    const result = await sendFriendRequest({ fromUserId: 'a', toUserId: 'b' }, deps);
    expect(result.status).toBe('accepted');
    expect(e(deps)).toHaveBeenCalledWith(
      expect.stringContaining('INSERT INTO social_graph.friendships'),
      ['a', 'b'],
    );
  });

  it('rejects when same-direction pending exists', async () => {
    const deps = makeDeps();
    q(deps)
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([])  // reverse - none
      .mockResolvedValueOnce([makeRequestRow()]);  // same-dir pending
    await expect(
      sendFriendRequest({ fromUserId: 'user-1', toUserId: 'user-2' }, deps),
    ).rejects.toMatchObject({ code: 'REQUEST_ALREADY_PENDING' });
  });

  it('creates a new pending request', async () => {
    const deps = makeDeps();
    q(deps)
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([makeRequestRow({ message: 'Ahoj' })]);
    const result = await sendFriendRequest(
      { fromUserId: 'user-1', toUserId: 'user-2', message: 'Ahoj' },
      deps,
    );
    expect(result.status).toBe('pending');
    expect(result.message).toBe('Ahoj');
  });
});

describe('acceptFriendRequest', () => {
  it('creates friendship and marks accepted', async () => {
    const deps = makeDeps();
    q(deps)
      .mockResolvedValueOnce([makeRequestRow()])
      .mockResolvedValueOnce([
        makeRequestRow({ status: 'accepted', responded_at: '2026-01-02' }),
      ]);

    const result = await acceptFriendRequest('req-1', 'user-2', deps);
    expect(result.status).toBe('accepted');
    expect(result.respondedAt).toBeInstanceOf(Date);
  });

  it('rejects when not the recipient', async () => {
    const deps = makeDeps();
    q(deps).mockResolvedValueOnce([makeRequestRow()]);
    await expect(
      acceptFriendRequest('req-1', 'user-other', deps),
    ).rejects.toMatchObject({ code: 'NOT_AUTHORIZED' });
  });

  it('rejects when request not pending', async () => {
    const deps = makeDeps();
    q(deps).mockResolvedValueOnce([makeRequestRow({ status: 'declined' })]);
    await expect(
      acceptFriendRequest('req-1', 'user-2', deps),
    ).rejects.toMatchObject({ code: 'REQUEST_NOT_FOUND' });
  });

  it('rejects when request missing', async () => {
    const deps = makeDeps();
    q(deps).mockResolvedValueOnce([]);
    await expect(
      acceptFriendRequest('req-x', 'user-2', deps),
    ).rejects.toMatchObject({ code: 'REQUEST_NOT_FOUND' });
  });
});

describe('declineFriendRequest', () => {
  it('marks declined when called by recipient', async () => {
    const deps = makeDeps();
    q(deps)
      .mockResolvedValueOnce([makeRequestRow()])
      .mockResolvedValueOnce([makeRequestRow({ status: 'declined' })]);
    const result = await declineFriendRequest('req-1', 'user-2', deps);
    expect(result.status).toBe('declined');
  });

  it('rejects when not the recipient', async () => {
    const deps = makeDeps();
    q(deps).mockResolvedValueOnce([makeRequestRow()]);
    await expect(
      declineFriendRequest('req-1', 'user-1', deps),
    ).rejects.toMatchObject({ code: 'NOT_AUTHORIZED' });
  });
});

describe('cancelFriendRequest', () => {
  it('marks cancelled when called by sender', async () => {
    const deps = makeDeps();
    q(deps)
      .mockResolvedValueOnce([makeRequestRow()])
      .mockResolvedValueOnce([makeRequestRow({ status: 'cancelled' })]);
    const result = await cancelFriendRequest('req-1', 'user-1', deps);
    expect(result.status).toBe('cancelled');
  });

  it('rejects when not the sender', async () => {
    const deps = makeDeps();
    q(deps).mockResolvedValueOnce([makeRequestRow()]);
    await expect(
      cancelFriendRequest('req-1', 'user-2', deps),
    ).rejects.toMatchObject({ code: 'NOT_AUTHORIZED' });
  });
});

describe('getIncomingRequests / getOutgoingRequests', () => {
  it('returns mapped incoming requests', async () => {
    const deps = makeDeps();
    q(deps).mockResolvedValueOnce([makeRequestRow(), makeRequestRow({ id: 'req-2' })]);
    const result = await getIncomingRequests('user-2', deps);
    expect(result).toHaveLength(2);
    expect(result[0]?.id).toBe('req-1');
  });

  it('returns mapped outgoing requests', async () => {
    const deps = makeDeps();
    q(deps).mockResolvedValueOnce([makeRequestRow()]);
    const result = await getOutgoingRequests('user-1', deps);
    expect(result).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// Friendships
// ---------------------------------------------------------------------------

describe('removeFriend', () => {
  it('deletes existing friendship', async () => {
    const deps = makeDeps();
    q(deps).mockResolvedValueOnce([{ user_a: 'a', user_b: 'b', created_at: '2026-01-01' }]);
    await removeFriend('a', 'b', deps);
    expect(e(deps)).toHaveBeenCalledWith(
      expect.stringContaining('DELETE FROM social_graph.friendships'),
      ['a', 'b'],
    );
  });

  it('throws NOT_FRIENDS when no friendship', async () => {
    const deps = makeDeps();
    q(deps).mockResolvedValueOnce([]);
    await expect(removeFriend('a', 'b', deps)).rejects.toMatchObject({ code: 'NOT_FRIENDS' });
  });
});

describe('getFriends / areFriends / getMutualFriends', () => {
  it('returns list of friend ids', async () => {
    const deps = makeDeps();
    q(deps).mockResolvedValueOnce([{ friend_id: 'b' }, { friend_id: 'c' }]);
    const result = await getFriends('a', deps);
    expect(result).toEqual(['b', 'c']);
  });

  it('areFriends returns true when row exists', async () => {
    const deps = makeDeps();
    q(deps).mockResolvedValueOnce([{ user_a: 'a' }]);
    expect(await areFriends('a', 'b', deps)).toBe(true);
  });

  it('areFriends returns false for self', async () => {
    const deps = makeDeps();
    expect(await areFriends('a', 'a', deps)).toBe(false);
  });

  it('areFriends returns false when no row', async () => {
    const deps = makeDeps();
    q(deps).mockResolvedValueOnce([]);
    expect(await areFriends('a', 'b', deps)).toBe(false);
  });

  it('getMutualFriends intersects two friend lists', async () => {
    const deps = makeDeps();
    q(deps)
      .mockResolvedValueOnce([{ friend_id: 'x' }, { friend_id: 'y' }, { friend_id: 'z' }])
      .mockResolvedValueOnce([{ friend_id: 'y' }, { friend_id: 'z' }, { friend_id: 'w' }]);
    const result = await getMutualFriends('a', 'b', deps);
    expect(result).toEqual(['y', 'z']);
  });
});

// ---------------------------------------------------------------------------
// Blocks
// ---------------------------------------------------------------------------

describe('blockUser', () => {
  it('refuses to block self', async () => {
    const deps = makeDeps();
    await expect(blockUser('a', 'a', deps)).rejects.toMatchObject({
      code: 'CANNOT_FRIEND_SELF',
    });
  });

  it('inserts block, removes friendship and cancels pending', async () => {
    const deps = makeDeps();
    await blockUser('a', 'b', deps);

    const calls = e(deps).mock.calls.map(c => c[0] as string);
    expect(calls.some(s => s.includes('INSERT INTO social_graph.blocks'))).toBe(true);
    expect(calls.some(s => s.includes('DELETE FROM social_graph.friendships'))).toBe(true);
    expect(
      calls.some(s => s.includes('UPDATE social_graph.friend_requests') && s.includes("'cancelled'")),
    ).toBe(true);
  });
});

describe('unblockUser / isBlocked', () => {
  it('unblockUser deletes block', async () => {
    const deps = makeDeps();
    await unblockUser('a', 'b', deps);
    expect(e(deps)).toHaveBeenCalledWith(
      expect.stringContaining('DELETE FROM social_graph.blocks'),
      ['a', 'b'],
    );
  });

  it('isBlocked returns true if any direction blocks', async () => {
    const deps = makeDeps();
    q(deps).mockResolvedValueOnce([{ user_id: 'a' }]);
    expect(await isBlocked('a', 'b', deps)).toBe(true);
  });

  it('isBlocked returns false when no rows', async () => {
    const deps = makeDeps();
    q(deps).mockResolvedValueOnce([]);
    expect(await isBlocked('a', 'b', deps)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Activities & feed
// ---------------------------------------------------------------------------

describe('recordActivity', () => {
  it('inserts activity with default visibility=friends', async () => {
    const deps = makeDeps();
    q(deps).mockResolvedValueOnce([makeActivityRow()]);

    const result = await recordActivity(
      {
        userId: 'user-2',
        activityType: 'planning_to_attend',
        eventId: 'event-1',
        eventTitle: 'The Prodigy',
        eventStartsAt: new Date('2026-05-01T19:00:00.000Z'),
      },
      deps,
    );

    expect(result.activityType).toBe('planning_to_attend');
    expect(result.visibility).toBe('friends');
  });

  it('respects explicit visibility=public and metadata', async () => {
    const deps = makeDeps();
    q(deps).mockResolvedValueOnce([
      makeActivityRow({
        visibility: 'public',
        metadata: { rating: 5 },
        activity_type: 'reviewed',
      }),
    ]);

    const result = await recordActivity(
      {
        userId: 'user-2',
        activityType: 'reviewed',
        eventId: 'event-1',
        eventTitle: 'The Prodigy',
        eventStartsAt: new Date('2026-05-01T19:00:00.000Z'),
        visibility: 'public',
        metadata: { rating: 5 },
      },
      deps,
    );

    expect(result.visibility).toBe('public');
    expect(result.metadata).toEqual({ rating: 5 });
  });
});

describe('getActivityFeed', () => {
  it('returns feed items with actor info', async () => {
    const deps = makeDeps();
    q(deps).mockResolvedValueOnce([
      { ...makeActivityRow(), display_name: 'Anna', avatar_url: 'url-a' },
      {
        ...makeActivityRow({ id: 'act-2', user_id: 'user-3' }),
        display_name: 'Bob',
        avatar_url: null,
      },
    ]);

    const result = await getActivityFeed('user-1', deps, { limit: 25 });
    expect(result).toHaveLength(2);
    expect(result[0]?.actorDisplayName).toBe('Anna');
    expect(result[1]?.actorAvatarUrl).toBeNull();
  });

  it('passes sinceCreatedAt filter into query', async () => {
    const deps = makeDeps();
    q(deps).mockResolvedValueOnce([]);
    await getActivityFeed('user-1', deps, {
      sinceCreatedAt: new Date('2026-04-01T00:00:00.000Z'),
    });
    const sql = q(deps).mock.calls[0]![0] as string;
    expect(sql).toContain("a.created_at > '2026-04-01");
  });
});

describe('getEventSocialContext', () => {
  it('returns empty summary when no friends are attending', async () => {
    const deps = makeDeps();
    q(deps).mockResolvedValueOnce([]);
    const result = await getEventSocialContext('user-1', 'event-1', deps);
    expect(result.totalFriends).toBe(0);
    expect(result.summary).toContain('Žádný z přátel');
  });

  it('builds singular summary for one friend', async () => {
    const deps = makeDeps();
    q(deps).mockResolvedValueOnce([
      { user_id: 'user-2', display_name: 'Petr', avatar_url: null },
    ]);
    const result = await getEventSocialContext('user-1', 'event-1', deps);
    expect(result.totalFriends).toBe(1);
    expect(result.summary).toBe('Petr plánuje jít.');
  });

  it('builds dual summary for two friends', async () => {
    const deps = makeDeps();
    q(deps).mockResolvedValueOnce([
      { user_id: 'user-2', display_name: 'Petr', avatar_url: null },
      { user_id: 'user-3', display_name: 'Anna', avatar_url: null },
    ]);
    const result = await getEventSocialContext('user-1', 'event-1', deps);
    expect(result.summary).toBe('Petr a Anna plánují jít.');
  });

  it('builds N-friends summary for 3+', async () => {
    const deps = makeDeps();
    q(deps).mockResolvedValueOnce([
      { user_id: 'user-2', display_name: 'Petr', avatar_url: null },
      { user_id: 'user-3', display_name: 'Anna', avatar_url: null },
      { user_id: 'user-4', display_name: 'Eva', avatar_url: null },
      { user_id: 'user-5', display_name: 'Karel', avatar_url: null },
    ]);
    const result = await getEventSocialContext('user-1', 'event-1', deps);
    expect(result.summary).toBe('Petr a 3 přátelé plánují jít.');
  });

  it('falls back to "Friend" for missing display name', async () => {
    const deps = makeDeps();
    q(deps).mockResolvedValueOnce([
      { user_id: 'user-2', display_name: null, avatar_url: null },
    ]);
    const result = await getEventSocialContext('user-1', 'event-1', deps);
    expect(result.friendsAttending[0]?.displayName).toBe('Friend');
  });
});

describe('getDiscovery', () => {
  it('returns discovery suggestions sorted by friend count', async () => {
    const deps = makeDeps();
    q(deps).mockResolvedValueOnce([
      {
        event_id: 'event-1',
        event_title: 'The Prodigy',
        event_starts_at: '2026-04-18T19:00:00.000Z',
        friend_count: '4',
        sample_user_ids: ['u-2', 'u-3', 'u-4', 'u-5'],
        sample_display_names: ['Petr', 'Anna', 'Eva', 'Karel'],
      },
      {
        event_id: 'event-2',
        event_title: 'Festival X',
        event_starts_at: '2026-04-19T15:00:00.000Z',
        friend_count: '2',
        sample_user_ids: ['u-2', 'u-3'],
        sample_display_names: ['Petr', 'Anna'],
      },
    ]);

    const result = await getDiscovery(
      'user-1',
      new Date('2026-04-18T00:00:00.000Z'),
      new Date('2026-04-20T00:00:00.000Z'),
      deps,
    );

    expect(result).toHaveLength(2);
    expect(result[0]?.friendCount).toBe(4);
    expect(result[0]?.sampleFriends).toHaveLength(3);  // capped at 3
    expect(result[0]?.sampleFriends[0]?.displayName).toBe('Petr');
    expect(result[1]?.eventTitle).toBe('Festival X');
  });

  it('handles missing display names gracefully', async () => {
    const deps = makeDeps();
    q(deps).mockResolvedValueOnce([
      {
        event_id: 'event-1',
        event_title: 'X',
        event_starts_at: '2026-04-18T19:00:00.000Z',
        friend_count: '1',
        sample_user_ids: ['u-2'],
        sample_display_names: [null],
      },
    ]);

    const result = await getDiscovery(
      'user-1',
      new Date('2026-04-18T00:00:00.000Z'),
      new Date('2026-04-20T00:00:00.000Z'),
      deps,
    );

    expect(result[0]?.sampleFriends[0]?.displayName).toBe('Friend');
  });
});

describe('markFeedRead', () => {
  it('upserts the feed_views row', async () => {
    const deps = makeDeps();
    await markFeedRead('user-1', deps);
    expect(e(deps)).toHaveBeenCalledWith(
      expect.stringContaining('INSERT INTO social_graph.feed_views'),
      ['user-1'],
    );
  });
});

// ---------------------------------------------------------------------------
// Sanity: error class
// ---------------------------------------------------------------------------

describe('FanSocialGraphError', () => {
  it('preserves code and name', () => {
    const err = new FanSocialGraphError('NOT_FRIENDS', 'no');
    expect(err.code).toBe('NOT_FRIENDS');
    expect(err.name).toBe('FanSocialGraphError');
    expect(err).toBeInstanceOf(Error);
  });
});
