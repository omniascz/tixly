import { randomUUID } from 'crypto';
import {
  type VirtualStream,
  type AttendeeAccess,
  type ServiceDeps,
  VirtualEventsError,
} from '../types/virtual-events.types';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const REPLAY_BUFFER_MS = 48 * 60 * 60 * 1000; // 48 hours

function computeExpiresAt(stream: VirtualStream, now: Date): Date {
  const base = stream.scheduledEndAt ?? stream.scheduledStartAt;
  return new Date(base.getTime() + REPLAY_BUFFER_MS);
}

// ---------------------------------------------------------------------------
// createZoomStream
// ---------------------------------------------------------------------------

export async function createZoomStream(
  eventId: string,
  params: {
    topic: string;
    startAt: Date;
    durationMinutes: number;
    passcode?: string;
  },
  deps: ServiceDeps
): Promise<VirtualStream> {
  const { db, zoom, now = () => new Date() } = deps;

  // Check for duplicate stream
  const existing = await db.query<{ id: string }>(
    'SELECT id FROM virtual_streams WHERE event_id = $1 LIMIT 1',
    [eventId]
  );
  if (existing.length > 0) {
    throw new VirtualEventsError('DUPLICATE_STREAM', `Event ${eventId} already has a stream`);
  }

  // Call Zoom API
  let meetingResult: Awaited<ReturnType<typeof zoom.createMeeting>>;
  try {
    meetingResult = await zoom.createMeeting({
      topic: params.topic,
      startTime: params.startAt,
      duration: params.durationMinutes,
      ...(params.passcode !== undefined ? { passcode: params.passcode } : {}),
    });
  } catch (err) {
    throw new VirtualEventsError('PROVIDER_ERROR', `Zoom error: ${String(err)}`);
  }

  const streamId = randomUUID();
  const createdAt = now();

  const stream: VirtualStream = {
    id: streamId,
    eventId,
    provider: 'zoom',
    providerStreamId: meetingResult.meetingId,
    streamUrl: meetingResult.joinUrl,
    hostUrl: meetingResult.hostUrl,
    passcode: meetingResult.passcode,
    status: 'scheduled',
    scheduledStartAt: params.startAt,
    scheduledEndAt: null,
    actualStartAt: null,
    actualEndAt: null,
    maxAttendees: null,
    createdAt,
  };

  await db.execute(
    `INSERT INTO virtual_streams
     (id, event_id, provider, provider_stream_id, stream_url, host_url, passcode,
      status, scheduled_start_at, scheduled_end_at, actual_start_at, actual_end_at,
      max_attendees, created_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)`,
    [
      stream.id, stream.eventId, stream.provider, stream.providerStreamId,
      stream.streamUrl, stream.hostUrl, stream.passcode, stream.status,
      stream.scheduledStartAt, stream.scheduledEndAt, stream.actualStartAt,
      stream.actualEndAt, stream.maxAttendees, stream.createdAt,
    ]
  );

  return stream;
}

// ---------------------------------------------------------------------------
// createYouTubeStream
// ---------------------------------------------------------------------------

export async function createYouTubeStream(
  eventId: string,
  params: {
    title: string;
    startAt: Date;
  },
  deps: ServiceDeps
): Promise<VirtualStream> {
  const { db, youtube, now = () => new Date() } = deps;

  // Check for duplicate stream
  const existing = await db.query<{ id: string }>(
    'SELECT id FROM virtual_streams WHERE event_id = $1 LIMIT 1',
    [eventId]
  );
  if (existing.length > 0) {
    throw new VirtualEventsError('DUPLICATE_STREAM', `Event ${eventId} already has a stream`);
  }

  // Call YouTube API
  let broadcastResult: Awaited<ReturnType<typeof youtube.createBroadcast>>;
  try {
    broadcastResult = await youtube.createBroadcast({
      title: params.title,
      scheduledStartAt: params.startAt,
    });
  } catch (err) {
    throw new VirtualEventsError('PROVIDER_ERROR', `YouTube error: ${String(err)}`);
  }

  const streamId = randomUUID();
  const createdAt = now();

  const stream: VirtualStream = {
    id: streamId,
    eventId,
    provider: 'youtube_live',
    providerStreamId: broadcastResult.broadcastId,
    streamUrl: broadcastResult.streamUrl,
    hostUrl: null,
    passcode: null,
    status: 'scheduled',
    scheduledStartAt: params.startAt,
    scheduledEndAt: null,
    actualStartAt: null,
    actualEndAt: null,
    maxAttendees: null,
    createdAt,
  };

  await db.execute(
    `INSERT INTO virtual_streams
     (id, event_id, provider, provider_stream_id, stream_url, host_url, passcode,
      status, scheduled_start_at, scheduled_end_at, actual_start_at, actual_end_at,
      max_attendees, created_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)`,
    [
      stream.id, stream.eventId, stream.provider, stream.providerStreamId,
      stream.streamUrl, stream.hostUrl, stream.passcode, stream.status,
      stream.scheduledStartAt, stream.scheduledEndAt, stream.actualStartAt,
      stream.actualEndAt, stream.maxAttendees, stream.createdAt,
    ]
  );

  return stream;
}

// ---------------------------------------------------------------------------
// createCustomStream
// ---------------------------------------------------------------------------

export async function createCustomStream(
  eventId: string,
  params: {
    streamUrl: string;
    hostUrl?: string;
    scheduledStartAt: Date;
    scheduledEndAt?: Date;
  },
  deps: ServiceDeps
): Promise<VirtualStream> {
  const { db, now = () => new Date() } = deps;

  // Check for duplicate stream
  const existing = await db.query<{ id: string }>(
    'SELECT id FROM virtual_streams WHERE event_id = $1 LIMIT 1',
    [eventId]
  );
  if (existing.length > 0) {
    throw new VirtualEventsError('DUPLICATE_STREAM', `Event ${eventId} already has a stream`);
  }

  const streamId = randomUUID();
  const createdAt = now();

  const stream: VirtualStream = {
    id: streamId,
    eventId,
    provider: 'custom',
    providerStreamId: null,
    streamUrl: params.streamUrl,
    hostUrl: params.hostUrl ?? null,
    passcode: null,
    status: 'scheduled',
    scheduledStartAt: params.scheduledStartAt,
    scheduledEndAt: params.scheduledEndAt ?? null,
    actualStartAt: null,
    actualEndAt: null,
    maxAttendees: null,
    createdAt,
  };

  await db.execute(
    `INSERT INTO virtual_streams
     (id, event_id, provider, provider_stream_id, stream_url, host_url, passcode,
      status, scheduled_start_at, scheduled_end_at, actual_start_at, actual_end_at,
      max_attendees, created_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)`,
    [
      stream.id, stream.eventId, stream.provider, stream.providerStreamId,
      stream.streamUrl, stream.hostUrl, stream.passcode, stream.status,
      stream.scheduledStartAt, stream.scheduledEndAt, stream.actualStartAt,
      stream.actualEndAt, stream.maxAttendees, stream.createdAt,
    ]
  );

  return stream;
}

// ---------------------------------------------------------------------------
// grantAttendeeAccess
// ---------------------------------------------------------------------------

export async function grantAttendeeAccess(
  streamId: string,
  ticketId: string,
  userId: string,
  deps: ServiceDeps
): Promise<AttendeeAccess> {
  const { db, now = () => new Date() } = deps;

  // Load stream
  const streams = await db.query<VirtualStream>(
    'SELECT * FROM virtual_streams WHERE id = $1',
    [streamId]
  );
  const stream = streams[0];
  if (!stream) {
    throw new VirtualEventsError('STREAM_NOT_FOUND', `Stream ${streamId} not found`);
  }

  const grantedAt = now();
  const expiresAt = computeExpiresAt(stream, grantedAt);
  const accessToken = randomUUID();
  const accessId = randomUUID();

  const access: AttendeeAccess = {
    id: accessId,
    streamId,
    ticketId,
    userId,
    status: 'granted',
    accessToken,
    grantedAt,
    expiresAt,
    joinedAt: null,
    leftAt: null,
  };

  await db.execute(
    `INSERT INTO attendee_access
     (id, stream_id, ticket_id, user_id, status, access_token, granted_at, expires_at, joined_at, left_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
    [
      access.id, access.streamId, access.ticketId, access.userId,
      access.status, access.accessToken, access.grantedAt, access.expiresAt,
      access.joinedAt, access.leftAt,
    ]
  );

  return access;
}

// ---------------------------------------------------------------------------
// validateAccess
// ---------------------------------------------------------------------------

export async function validateAccess(
  accessToken: string,
  deps: ServiceDeps
): Promise<AttendeeAccess> {
  const { db, now = () => new Date() } = deps;

  const rows = await db.query<AttendeeAccess>(
    'SELECT * FROM attendee_access WHERE access_token = $1',
    [accessToken]
  );
  const access = rows[0];
  if (!access) {
    throw new VirtualEventsError('ACCESS_NOT_FOUND', 'Access not found');
  }

  if (access.status === 'revoked') {
    throw new VirtualEventsError('ACCESS_REVOKED', 'Access has been revoked');
  }

  const currentTime = now();
  if (access.expiresAt < currentTime) {
    throw new VirtualEventsError('ACCESS_EXPIRED', 'Access token has expired');
  }

  if (access.status !== 'granted') {
    throw new VirtualEventsError('ACCESS_REVOKED', 'Access is not in granted state');
  }

  // Update joinedAt if null
  if (access.joinedAt === null) {
    await db.execute(
      'UPDATE attendee_access SET joined_at = $1 WHERE id = $2',
      [currentTime, access.id]
    );
    access.joinedAt = currentTime;
  }

  return access;
}

// ---------------------------------------------------------------------------
// revokeAccess
// ---------------------------------------------------------------------------

export async function revokeAccess(
  accessId: string,
  deps: ServiceDeps
): Promise<void> {
  const { db } = deps;

  const rows = await db.query<{ id: string }>(
    'SELECT id FROM attendee_access WHERE id = $1',
    [accessId]
  );
  if (rows.length === 0) {
    throw new VirtualEventsError('ACCESS_NOT_FOUND', `Access ${accessId} not found`);
  }

  await db.execute(
    "UPDATE attendee_access SET status = 'revoked' WHERE id = $1",
    [accessId]
  );
}

// ---------------------------------------------------------------------------
// syncStreamStatus
// ---------------------------------------------------------------------------

export async function syncStreamStatus(
  streamId: string,
  deps: ServiceDeps
): Promise<VirtualStream> {
  const { db, zoom, youtube, now = () => new Date() } = deps;

  const streams = await db.query<VirtualStream>(
    'SELECT * FROM virtual_streams WHERE id = $1',
    [streamId]
  );
  const stream = streams[0];
  if (!stream) {
    throw new VirtualEventsError('STREAM_NOT_FOUND', `Stream ${streamId} not found`);
  }

  // Custom: no-op
  if (stream.provider === 'custom') {
    return stream;
  }

  if (stream.provider === 'zoom' && stream.providerStreamId !== null) {
    let zoomStatus: Awaited<ReturnType<typeof zoom.getMeetingStatus>>;
    try {
      zoomStatus = await zoom.getMeetingStatus(stream.providerStreamId);
    } catch (err) {
      throw new VirtualEventsError('PROVIDER_ERROR', `Zoom error: ${String(err)}`);
    }

    let newStatus = stream.status;
    let actualStartAt = stream.actualStartAt;
    let actualEndAt = stream.actualEndAt;
    const currentTime = now();

    if (zoomStatus.status === 'started') {
      newStatus = 'live';
      if (actualStartAt === null) {
        actualStartAt = currentTime;
      }
    } else if (zoomStatus.status === 'finished') {
      newStatus = 'ended';
      if (actualEndAt === null) {
        actualEndAt = currentTime;
      }
    } else {
      // 'waiting' → scheduled
      newStatus = 'scheduled';
    }

    await db.execute(
      'UPDATE virtual_streams SET status = $1, actual_start_at = $2, actual_end_at = $3 WHERE id = $4',
      [newStatus, actualStartAt, actualEndAt, streamId]
    );

    stream.status = newStatus;
    stream.actualStartAt = actualStartAt;
    stream.actualEndAt = actualEndAt;
  } else if (stream.provider === 'youtube_live' && stream.providerStreamId !== null) {
    let ytStatus: Awaited<ReturnType<typeof youtube.getBroadcastStatus>>;
    try {
      ytStatus = await youtube.getBroadcastStatus(stream.providerStreamId);
    } catch (err) {
      throw new VirtualEventsError('PROVIDER_ERROR', `YouTube error: ${String(err)}`);
    }

    let newStatus = stream.status;
    let actualStartAt = stream.actualStartAt;
    let actualEndAt = stream.actualEndAt;
    const currentTime = now();

    if (ytStatus.status === 'live') {
      newStatus = 'live';
      if (actualStartAt === null) {
        actualStartAt = currentTime;
      }
    } else if (ytStatus.status === 'complete') {
      newStatus = 'ended';
      if (actualEndAt === null) {
        actualEndAt = currentTime;
      }
    } else {
      // 'ready' → scheduled
      newStatus = 'scheduled';
    }

    await db.execute(
      'UPDATE virtual_streams SET status = $1, actual_start_at = $2, actual_end_at = $3 WHERE id = $4',
      [newStatus, actualStartAt, actualEndAt, streamId]
    );

    stream.status = newStatus;
    stream.actualStartAt = actualStartAt;
    stream.actualEndAt = actualEndAt;
  }

  return stream;
}

// ---------------------------------------------------------------------------
// endStream
// ---------------------------------------------------------------------------

export async function endStream(
  streamId: string,
  deps: ServiceDeps
): Promise<VirtualStream> {
  const { db, now = () => new Date() } = deps;

  const streams = await db.query<VirtualStream>(
    'SELECT * FROM virtual_streams WHERE id = $1',
    [streamId]
  );
  const stream = streams[0];
  if (!stream) {
    throw new VirtualEventsError('STREAM_NOT_FOUND', `Stream ${streamId} not found`);
  }

  const currentTime = now();

  await db.execute(
    "UPDATE virtual_streams SET status = 'ended', actual_end_at = $1 WHERE id = $2",
    [currentTime, streamId]
  );

  stream.status = 'ended';
  stream.actualEndAt = currentTime;

  return stream;
}

// ---------------------------------------------------------------------------
// getStreamAttendees
// ---------------------------------------------------------------------------

export async function getStreamAttendees(
  streamId: string,
  deps: ServiceDeps
): Promise<AttendeeAccess[]> {
  const { db } = deps;

  // Verify stream exists
  const streams = await db.query<{ id: string }>(
    'SELECT id FROM virtual_streams WHERE id = $1',
    [streamId]
  );
  if (streams.length === 0) {
    throw new VirtualEventsError('STREAM_NOT_FOUND', `Stream ${streamId} not found`);
  }

  return db.query<AttendeeAccess>(
    'SELECT * FROM attendee_access WHERE stream_id = $1 ORDER BY granted_at ASC',
    [streamId]
  );
}
