import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  createZoomStream,
  createYouTubeStream,
  createCustomStream,
  grantAttendeeAccess,
  validateAccess,
  revokeAccess,
  syncStreamStatus,
  endStream,
  getStreamAttendees,
} from '../services/virtual-events.service';
import {
  VirtualEventsError,
  type DbAdapter,
  type ZoomAdapter,
  type YouTubeAdapter,
  type ServiceDeps,
  type VirtualStream,
  type AttendeeAccess,
} from '../types/virtual-events.types';

// ---------------------------------------------------------------------------
// Factories
// ---------------------------------------------------------------------------

function makeDb(): DbAdapter {
  return {
    query: vi.fn().mockResolvedValue([]),
    execute: vi.fn().mockResolvedValue(undefined),
    transaction: vi.fn().mockImplementation(async (fn) => fn(makeDb())),
  };
}

function makeZoom(): ZoomAdapter {
  return {
    createMeeting: vi.fn().mockResolvedValue({
      meetingId: 'zoom-meeting-123',
      joinUrl: 'https://zoom.us/j/123',
      hostUrl: 'https://zoom.us/s/123',
      passcode: 'secret',
    }),
    deleteMeeting: vi.fn().mockResolvedValue(undefined),
    getMeetingStatus: vi.fn().mockResolvedValue({ status: 'waiting' }),
    addRegistrant: vi.fn().mockResolvedValue({ joinUrl: 'https://zoom.us/j/123?tk=abc' }),
  };
}

function makeYouTube(): YouTubeAdapter {
  return {
    createBroadcast: vi.fn().mockResolvedValue({
      broadcastId: 'yt-broadcast-456',
      streamUrl: 'https://youtube.com/live/456',
      embedUrl: 'https://youtube.com/embed/456',
    }),
    getBroadcastStatus: vi.fn().mockResolvedValue({ status: 'ready' }),
  };
}

const FIXED_NOW = new Date('2026-04-15T10:00:00.000Z');

function makeDeps(overrides?: Partial<ServiceDeps>): ServiceDeps {
  return {
    db: makeDb(),
    zoom: makeZoom(),
    youtube: makeYouTube(),
    now: () => FIXED_NOW,
    ...overrides,
  };
}

function makeStream(overrides?: Partial<VirtualStream>): VirtualStream {
  return {
    id: 'stream-1',
    eventId: 'event-1',
    provider: 'zoom',
    providerStreamId: 'zoom-meeting-123',
    streamUrl: 'https://zoom.us/j/123',
    hostUrl: 'https://zoom.us/s/123',
    passcode: 'secret',
    status: 'scheduled',
    scheduledStartAt: new Date('2026-04-15T12:00:00.000Z'),
    scheduledEndAt: new Date('2026-04-15T14:00:00.000Z'),
    actualStartAt: null,
    actualEndAt: null,
    maxAttendees: null,
    createdAt: FIXED_NOW,
    ...overrides,
  };
}

function makeAccess(overrides?: Partial<AttendeeAccess>): AttendeeAccess {
  return {
    id: 'access-1',
    streamId: 'stream-1',
    ticketId: 'ticket-1',
    userId: 'user-1',
    status: 'granted',
    accessToken: 'token-abc',
    grantedAt: FIXED_NOW,
    expiresAt: new Date('2026-04-17T14:00:00.000Z'),
    joinedAt: null,
    leftAt: null,
    ...overrides,
  };
}

// ===========================================================================
// createZoomStream
// ===========================================================================

describe('createZoomStream', () => {
  it('creates a zoom stream successfully', async () => {
    const deps = makeDeps();
    const startAt = new Date('2026-04-15T12:00:00.000Z');

    const stream = await createZoomStream('event-1', {
      topic: 'Tech Conference',
      startAt,
      durationMinutes: 120,
      passcode: 'mypass',
    }, deps);

    expect(stream.provider).toBe('zoom');
    expect(stream.providerStreamId).toBe('zoom-meeting-123');
    expect(stream.streamUrl).toBe('https://zoom.us/j/123');
    expect(stream.hostUrl).toBe('https://zoom.us/s/123');
    expect(stream.passcode).toBe('secret');
    expect(stream.status).toBe('scheduled');
    expect(stream.eventId).toBe('event-1');
    expect(stream.scheduledStartAt).toEqual(startAt);
  });

  it('calls zoom adapter with correct params', async () => {
    const deps = makeDeps();
    const startAt = new Date('2026-04-15T12:00:00.000Z');

    await createZoomStream('event-1', {
      topic: 'Tech Conference',
      startAt,
      durationMinutes: 90,
      passcode: 'pass123',
    }, deps);

    expect(deps.zoom.createMeeting).toHaveBeenCalledWith({
      topic: 'Tech Conference',
      startTime: startAt,
      duration: 90,
      passcode: 'pass123',
    });
  });

  it('throws DUPLICATE_STREAM if event already has a stream', async () => {
    const deps = makeDeps();
    vi.mocked(deps.db.query).mockResolvedValueOnce([{ id: 'existing-stream' }]);

    await expect(
      createZoomStream('event-1', {
        topic: 'Duplicate',
        startAt: new Date(),
        durationMinutes: 60,
      }, deps)
    ).rejects.toThrow(VirtualEventsError);

    await expect(
      createZoomStream('event-1', {
        topic: 'Duplicate',
        startAt: new Date(),
        durationMinutes: 60,
      }, { ...deps, db: { ...deps.db, query: vi.fn().mockResolvedValue([{ id: 'existing' }]) } })
    ).rejects.toMatchObject({ code: 'DUPLICATE_STREAM' });
  });

  it('inserts stream into DB', async () => {
    const deps = makeDeps();
    await createZoomStream('event-1', {
      topic: 'Concert',
      startAt: new Date('2026-04-15T12:00:00.000Z'),
      durationMinutes: 60,
    }, deps);

    expect(deps.db.execute).toHaveBeenCalledOnce();
    const call = vi.mocked(deps.db.execute).mock.calls[0];
    expect(call).toBeDefined();
    expect(call![0]).toContain('INSERT INTO virtual_streams');
  });
});

// ===========================================================================
// createYouTubeStream
// ===========================================================================

describe('createYouTubeStream', () => {
  it('creates a youtube stream successfully', async () => {
    const deps = makeDeps();
    const startAt = new Date('2026-04-15T18:00:00.000Z');

    const stream = await createYouTubeStream('event-2', {
      title: 'Live Festival',
      startAt,
    }, deps);

    expect(stream.provider).toBe('youtube_live');
    expect(stream.providerStreamId).toBe('yt-broadcast-456');
    expect(stream.streamUrl).toBe('https://youtube.com/live/456');
    expect(stream.status).toBe('scheduled');
    expect(stream.hostUrl).toBeNull();
    expect(stream.passcode).toBeNull();
  });

  it('calls youtube adapter with correct params', async () => {
    const deps = makeDeps();
    const startAt = new Date('2026-04-15T18:00:00.000Z');

    await createYouTubeStream('event-2', { title: 'Festival Stream', startAt }, deps);

    expect(deps.youtube.createBroadcast).toHaveBeenCalledWith({
      title: 'Festival Stream',
      scheduledStartAt: startAt,
    });
  });

  it('throws DUPLICATE_STREAM for youtube if event already has a stream', async () => {
    const deps = makeDeps();
    vi.mocked(deps.db.query).mockResolvedValueOnce([{ id: 'existing' }]);

    await expect(
      createYouTubeStream('event-2', { title: 'Dup', startAt: new Date() }, deps)
    ).rejects.toMatchObject({ code: 'DUPLICATE_STREAM' });
  });
});

// ===========================================================================
// createCustomStream
// ===========================================================================

describe('createCustomStream', () => {
  it('creates a custom stream with direct URL', async () => {
    const deps = makeDeps();
    const startAt = new Date('2026-04-15T20:00:00.000Z');
    const endAt = new Date('2026-04-15T22:00:00.000Z');

    const stream = await createCustomStream('event-3', {
      streamUrl: 'https://mystream.example.com/live',
      hostUrl: 'https://mystream.example.com/host',
      scheduledStartAt: startAt,
      scheduledEndAt: endAt,
    }, deps);

    expect(stream.provider).toBe('custom');
    expect(stream.providerStreamId).toBeNull();
    expect(stream.streamUrl).toBe('https://mystream.example.com/live');
    expect(stream.hostUrl).toBe('https://mystream.example.com/host');
    expect(stream.scheduledEndAt).toEqual(endAt);
    expect(stream.status).toBe('scheduled');
  });

  it('creates custom stream without optional hostUrl and scheduledEndAt', async () => {
    const deps = makeDeps();
    const stream = await createCustomStream('event-4', {
      streamUrl: 'https://mystream.example.com/live',
      scheduledStartAt: new Date('2026-04-15T20:00:00.000Z'),
    }, deps);

    expect(stream.hostUrl).toBeNull();
    expect(stream.scheduledEndAt).toBeNull();
  });

  it('does not call zoom or youtube adapters', async () => {
    const deps = makeDeps();
    await createCustomStream('event-5', {
      streamUrl: 'https://custom.example.com',
      scheduledStartAt: new Date(),
    }, deps);

    expect(deps.zoom.createMeeting).not.toHaveBeenCalled();
    expect(deps.youtube.createBroadcast).not.toHaveBeenCalled();
  });
});

// ===========================================================================
// grantAttendeeAccess
// ===========================================================================

describe('grantAttendeeAccess', () => {
  it('grants access and returns AttendeeAccess with correct fields', async () => {
    const stream = makeStream({
      scheduledEndAt: new Date('2026-04-15T14:00:00.000Z'),
    });
    const deps = makeDeps();
    vi.mocked(deps.db.query).mockResolvedValueOnce([stream]);

    const access = await grantAttendeeAccess('stream-1', 'ticket-1', 'user-1', deps);

    expect(access.streamId).toBe('stream-1');
    expect(access.ticketId).toBe('ticket-1');
    expect(access.userId).toBe('user-1');
    expect(access.status).toBe('granted');
    expect(typeof access.accessToken).toBe('string');
    expect(access.accessToken.length).toBeGreaterThan(0);
    expect(access.joinedAt).toBeNull();
    expect(access.leftAt).toBeNull();
  });

  it('computes expiresAt as scheduledEndAt + 48h', async () => {
    const endAt = new Date('2026-04-15T14:00:00.000Z');
    const stream = makeStream({ scheduledEndAt: endAt });
    const deps = makeDeps();
    vi.mocked(deps.db.query).mockResolvedValueOnce([stream]);

    const access = await grantAttendeeAccess('stream-1', 'ticket-1', 'user-1', deps);

    const expectedExpiry = new Date(endAt.getTime() + 48 * 60 * 60 * 1000);
    expect(access.expiresAt).toEqual(expectedExpiry);
  });

  it('uses scheduledStartAt + 48h when no scheduledEndAt', async () => {
    const startAt = new Date('2026-04-15T12:00:00.000Z');
    const stream = makeStream({ scheduledEndAt: null, scheduledStartAt: startAt });
    const deps = makeDeps();
    vi.mocked(deps.db.query).mockResolvedValueOnce([stream]);

    const access = await grantAttendeeAccess('stream-1', 'ticket-1', 'user-1', deps);

    const expectedExpiry = new Date(startAt.getTime() + 48 * 60 * 60 * 1000);
    expect(access.expiresAt).toEqual(expectedExpiry);
  });

  it('throws STREAM_NOT_FOUND if stream does not exist', async () => {
    const deps = makeDeps();
    vi.mocked(deps.db.query).mockResolvedValueOnce([]);

    await expect(
      grantAttendeeAccess('nonexistent', 'ticket-1', 'user-1', deps)
    ).rejects.toMatchObject({ code: 'STREAM_NOT_FOUND' });
  });
});

// ===========================================================================
// validateAccess
// ===========================================================================

describe('validateAccess', () => {
  it('validates access successfully and sets joinedAt', async () => {
    const access = makeAccess({
      joinedAt: null,
      expiresAt: new Date('2026-04-17T14:00:00.000Z'), // future
    });
    const deps = makeDeps();
    vi.mocked(deps.db.query).mockResolvedValueOnce([access]);

    const result = await validateAccess('token-abc', deps);

    expect(result.status).toBe('granted');
    expect(result.joinedAt).toEqual(FIXED_NOW);
    expect(deps.db.execute).toHaveBeenCalledWith(
      expect.stringContaining('UPDATE attendee_access SET joined_at'),
      expect.arrayContaining([FIXED_NOW, access.id])
    );
  });

  it('does not update joinedAt if already set', async () => {
    const joinedAt = new Date('2026-04-15T12:30:00.000Z');
    const access = makeAccess({
      joinedAt,
      expiresAt: new Date('2026-04-17T14:00:00.000Z'),
    });
    const deps = makeDeps();
    vi.mocked(deps.db.query).mockResolvedValueOnce([access]);

    await validateAccess('token-abc', deps);

    expect(deps.db.execute).not.toHaveBeenCalled();
  });

  it('throws ACCESS_EXPIRED when token is expired', async () => {
    const access = makeAccess({
      expiresAt: new Date('2026-04-14T00:00:00.000Z'), // past
    });
    const deps = makeDeps();
    vi.mocked(deps.db.query).mockResolvedValueOnce([access]);

    await expect(validateAccess('token-abc', deps)).rejects.toMatchObject({
      code: 'ACCESS_EXPIRED',
    });
  });

  it('throws ACCESS_REVOKED when status is revoked', async () => {
    const access = makeAccess({
      status: 'revoked',
      expiresAt: new Date('2026-04-17T14:00:00.000Z'),
    });
    const deps = makeDeps();
    vi.mocked(deps.db.query).mockResolvedValueOnce([access]);

    await expect(validateAccess('token-abc', deps)).rejects.toMatchObject({
      code: 'ACCESS_REVOKED',
    });
  });

  it('throws ACCESS_NOT_FOUND when token does not exist', async () => {
    const deps = makeDeps();
    vi.mocked(deps.db.query).mockResolvedValueOnce([]);

    await expect(validateAccess('nonexistent-token', deps)).rejects.toMatchObject({
      code: 'ACCESS_NOT_FOUND',
    });
  });
});

// ===========================================================================
// revokeAccess
// ===========================================================================

describe('revokeAccess', () => {
  it('revokes access successfully', async () => {
    const deps = makeDeps();
    vi.mocked(deps.db.query).mockResolvedValueOnce([{ id: 'access-1' }]);

    await revokeAccess('access-1', deps);

    expect(deps.db.execute).toHaveBeenCalledWith(
      expect.stringContaining("status = 'revoked'"),
      ['access-1']
    );
  });

  it('throws ACCESS_NOT_FOUND for non-existent access', async () => {
    const deps = makeDeps();
    vi.mocked(deps.db.query).mockResolvedValueOnce([]);

    await expect(revokeAccess('nonexistent', deps)).rejects.toMatchObject({
      code: 'ACCESS_NOT_FOUND',
    });
  });
});

// ===========================================================================
// syncStreamStatus
// ===========================================================================

describe('syncStreamStatus', () => {
  it('maps Zoom "started" to "live" and sets actualStartAt', async () => {
    const stream = makeStream({ provider: 'zoom', status: 'scheduled', actualStartAt: null });
    const deps = makeDeps();
    vi.mocked(deps.db.query).mockResolvedValueOnce([stream]);
    vi.mocked(deps.zoom.getMeetingStatus).mockResolvedValueOnce({ status: 'started' });

    const result = await syncStreamStatus('stream-1', deps);

    expect(result.status).toBe('live');
    expect(result.actualStartAt).toEqual(FIXED_NOW);
    expect(deps.db.execute).toHaveBeenCalledWith(
      expect.stringContaining('UPDATE virtual_streams SET status'),
      ['live', FIXED_NOW, null, 'stream-1']
    );
  });

  it('maps Zoom "finished" to "ended" and sets actualEndAt', async () => {
    const stream = makeStream({
      provider: 'zoom',
      status: 'live',
      actualStartAt: new Date('2026-04-15T12:00:00.000Z'),
    });
    const deps = makeDeps();
    vi.mocked(deps.db.query).mockResolvedValueOnce([stream]);
    vi.mocked(deps.zoom.getMeetingStatus).mockResolvedValueOnce({ status: 'finished' });

    const result = await syncStreamStatus('stream-1', deps);

    expect(result.status).toBe('ended');
    expect(result.actualEndAt).toEqual(FIXED_NOW);
  });

  it('maps Zoom "waiting" to "scheduled"', async () => {
    const stream = makeStream({ provider: 'zoom', status: 'live' });
    const deps = makeDeps();
    vi.mocked(deps.db.query).mockResolvedValueOnce([stream]);
    vi.mocked(deps.zoom.getMeetingStatus).mockResolvedValueOnce({ status: 'waiting' });

    const result = await syncStreamStatus('stream-1', deps);

    expect(result.status).toBe('scheduled');
  });

  it('maps YouTube "live" to "live"', async () => {
    const stream = makeStream({
      provider: 'youtube_live',
      providerStreamId: 'yt-broadcast-456',
      status: 'scheduled',
      actualStartAt: null,
    });
    const deps = makeDeps();
    vi.mocked(deps.db.query).mockResolvedValueOnce([stream]);
    vi.mocked(deps.youtube.getBroadcastStatus).mockResolvedValueOnce({ status: 'live' });

    const result = await syncStreamStatus('stream-1', deps);

    expect(result.status).toBe('live');
    expect(result.actualStartAt).toEqual(FIXED_NOW);
  });

  it('maps YouTube "complete" to "ended"', async () => {
    const stream = makeStream({
      provider: 'youtube_live',
      providerStreamId: 'yt-broadcast-456',
      status: 'live',
      actualStartAt: new Date('2026-04-15T12:00:00.000Z'),
    });
    const deps = makeDeps();
    vi.mocked(deps.db.query).mockResolvedValueOnce([stream]);
    vi.mocked(deps.youtube.getBroadcastStatus).mockResolvedValueOnce({ status: 'complete' });

    const result = await syncStreamStatus('stream-1', deps);

    expect(result.status).toBe('ended');
    expect(result.actualEndAt).toEqual(FIXED_NOW);
  });

  it('maps YouTube "ready" to "scheduled"', async () => {
    const stream = makeStream({
      provider: 'youtube_live',
      providerStreamId: 'yt-broadcast-456',
      status: 'live',
    });
    const deps = makeDeps();
    vi.mocked(deps.db.query).mockResolvedValueOnce([stream]);
    vi.mocked(deps.youtube.getBroadcastStatus).mockResolvedValueOnce({ status: 'ready' });

    const result = await syncStreamStatus('stream-1', deps);

    expect(result.status).toBe('scheduled');
  });

  it('is no-op for custom streams', async () => {
    const stream = makeStream({ provider: 'custom', providerStreamId: null });
    const deps = makeDeps();
    vi.mocked(deps.db.query).mockResolvedValueOnce([stream]);

    const result = await syncStreamStatus('stream-1', deps);

    expect(deps.zoom.getMeetingStatus).not.toHaveBeenCalled();
    expect(deps.youtube.getBroadcastStatus).not.toHaveBeenCalled();
    expect(deps.db.execute).not.toHaveBeenCalled();
    expect(result.status).toBe(stream.status);
  });

  it('throws STREAM_NOT_FOUND for non-existent stream', async () => {
    const deps = makeDeps();
    vi.mocked(deps.db.query).mockResolvedValueOnce([]);

    await expect(syncStreamStatus('nonexistent', deps)).rejects.toMatchObject({
      code: 'STREAM_NOT_FOUND',
    });
  });
});

// ===========================================================================
// endStream
// ===========================================================================

describe('endStream', () => {
  it('sets status to ended and records actualEndAt', async () => {
    const stream = makeStream({ status: 'live' });
    const deps = makeDeps();
    vi.mocked(deps.db.query).mockResolvedValueOnce([stream]);

    const result = await endStream('stream-1', deps);

    expect(result.status).toBe('ended');
    expect(result.actualEndAt).toEqual(FIXED_NOW);
    expect(deps.db.execute).toHaveBeenCalledWith(
      expect.stringContaining("status = 'ended'"),
      [FIXED_NOW, 'stream-1']
    );
  });

  it('throws STREAM_NOT_FOUND for non-existent stream', async () => {
    const deps = makeDeps();
    vi.mocked(deps.db.query).mockResolvedValueOnce([]);

    await expect(endStream('nonexistent', deps)).rejects.toMatchObject({
      code: 'STREAM_NOT_FOUND',
    });
  });
});
