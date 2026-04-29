// =============================================================================
// Session Service
//
// Covers: conference sessions CRUD + filtering
// DB schema: conference.sessions, conference.session_speakers
// =============================================================================

import { ConferenceError } from '../lib/conference-errors';

// ---------------------------------------------------------------------------
// DB adapter
// ---------------------------------------------------------------------------

export interface SessionDB {
  query<T>(sql: string, params?: unknown[]): Promise<T[]>;
  execute(sql: string, params?: unknown[]): Promise<void>;
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type SessionType = 'talk' | 'workshop' | 'panel' | 'keynote' | 'break' | 'networking';

export interface CreateSessionInput {
  dayId: string;
  trackId?: string;
  title: string;
  description?: string;
  sessionType: SessionType;
  startsAt: string;
  endsAt: string;
  room?: string;
  capacity?: number;
  isRecorded?: boolean;
  slidesUrl?: string;
  videoUrl?: string;
  sortOrder?: number;
}

export interface UpdateSessionInput {
  dayId?: string;
  trackId?: string | null;
  title?: string;
  description?: string;
  sessionType?: SessionType;
  startsAt?: string;
  endsAt?: string;
  room?: string;
  capacity?: number;
  isRecorded?: boolean;
  slidesUrl?: string;
  videoUrl?: string;
  sortOrder?: number;
}

export interface ListSessionsFilters {
  dayId?: string;
  trackId?: string;
  sessionType?: SessionType;
}

export interface SessionSpeakerInfo {
  id: string;
  fullName: string;
  role: string;
  sortOrder: number;
}

export interface Session {
  id: string;
  conferenceId: string;
  dayId: string;
  trackId: string | null;
  title: string;
  description: string | null;
  sessionType: SessionType;
  startsAt: string;
  endsAt: string;
  room: string | null;
  capacity: number | null;
  isRecorded: boolean;
  slidesUrl: string | null;
  videoUrl: string | null;
  sortOrder: number;
}

export interface SessionWithSpeakers extends Session {
  speakers: SessionSpeakerInfo[];
}

// ---------------------------------------------------------------------------
// Row types
// ---------------------------------------------------------------------------

interface SessionRow {
  id: string;
  conference_id: string;
  day_id: string;
  track_id: string | null;
  title: string;
  description: string | null;
  session_type: string;
  starts_at: string;
  ends_at: string;
  room: string | null;
  capacity: number | null;
  is_recorded: boolean;
  slides_url: string | null;
  video_url: string | null;
  sort_order: number;
}

interface SessionSpeakerRow {
  id: string;
  full_name: string;
  role: string;
  sort_order: number;
}

// ---------------------------------------------------------------------------
// Mapper
// ---------------------------------------------------------------------------

function mapSession(row: SessionRow): Session {
  return {
    id: row.id,
    conferenceId: row.conference_id,
    dayId: row.day_id,
    trackId: row.track_id,
    title: row.title,
    description: row.description,
    sessionType: row.session_type as SessionType,
    startsAt: row.starts_at,
    endsAt: row.ends_at,
    room: row.room,
    capacity: row.capacity,
    isRecorded: row.is_recorded,
    slidesUrl: row.slides_url,
    videoUrl: row.video_url,
    sortOrder: row.sort_order,
  };
}

// ---------------------------------------------------------------------------
// 1. createSession
// ---------------------------------------------------------------------------

export async function createSession(
  conferenceId: string,
  input: CreateSessionInput,
  db: SessionDB,
): Promise<Session> {
  // Validate time range
  if (new Date(input.endsAt) <= new Date(input.startsAt)) {
    throw new ConferenceError('INVALID_SESSION_TYPE', 'ends_at must be after starts_at');
  }

  const [row] = await db.query<SessionRow>(
    `INSERT INTO conference.sessions
       (conference_id, day_id, track_id, title, description, session_type,
        starts_at, ends_at, room, capacity, is_recorded, slides_url, video_url, sort_order)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)
     RETURNING *`,
    [
      conferenceId,
      input.dayId,
      input.trackId ?? null,
      input.title,
      input.description ?? null,
      input.sessionType,
      input.startsAt,
      input.endsAt,
      input.room ?? null,
      input.capacity ?? null,
      input.isRecorded ?? false,
      input.slidesUrl ?? null,
      input.videoUrl ?? null,
      input.sortOrder ?? 0,
    ],
  );
  return mapSession(row);
}

// ---------------------------------------------------------------------------
// 2. getSession
// ---------------------------------------------------------------------------

export async function getSession(
  sessionId: string,
  db: SessionDB,
): Promise<SessionWithSpeakers> {
  const [row] = await db.query<SessionRow>(
    `SELECT * FROM conference.sessions WHERE id = $1`,
    [sessionId],
  );
  if (!row) throw new ConferenceError('SESSION_NOT_FOUND');

  const speakers = await db.query<SessionSpeakerRow>(
    `SELECT sp.id, sp.full_name, ss.role, ss.sort_order
     FROM conference.session_speakers ss
     JOIN conference.speakers sp ON sp.id = ss.speaker_id
     WHERE ss.session_id = $1
     ORDER BY ss.sort_order ASC`,
    [sessionId],
  );

  return {
    ...mapSession(row),
    speakers: speakers.map(s => ({
      id: s.id,
      fullName: s.full_name,
      role: s.role,
      sortOrder: s.sort_order,
    })),
  };
}

// ---------------------------------------------------------------------------
// 3. updateSession
// ---------------------------------------------------------------------------

export async function updateSession(
  sessionId: string,
  input: UpdateSessionInput,
  db: SessionDB,
): Promise<Session> {
  // Validate time if both provided
  if (input.startsAt && input.endsAt) {
    if (new Date(input.endsAt) <= new Date(input.startsAt)) {
      throw new ConferenceError('INVALID_SESSION_TYPE', 'ends_at must be after starts_at');
    }
  }

  const sets: string[] = [];
  const params: unknown[] = [];
  let idx = 1;

  if (input.dayId !== undefined)       { sets.push(`day_id = $${idx++}`);       params.push(input.dayId); }
  if (input.trackId !== undefined)     { sets.push(`track_id = $${idx++}`);     params.push(input.trackId); }
  if (input.title !== undefined)       { sets.push(`title = $${idx++}`);        params.push(input.title); }
  if (input.description !== undefined) { sets.push(`description = $${idx++}`);  params.push(input.description); }
  if (input.sessionType !== undefined) { sets.push(`session_type = $${idx++}`); params.push(input.sessionType); }
  if (input.startsAt !== undefined)    { sets.push(`starts_at = $${idx++}`);    params.push(input.startsAt); }
  if (input.endsAt !== undefined)      { sets.push(`ends_at = $${idx++}`);      params.push(input.endsAt); }
  if (input.room !== undefined)        { sets.push(`room = $${idx++}`);         params.push(input.room); }
  if (input.capacity !== undefined)    { sets.push(`capacity = $${idx++}`);     params.push(input.capacity); }
  if (input.isRecorded !== undefined)  { sets.push(`is_recorded = $${idx++}`);  params.push(input.isRecorded); }
  if (input.slidesUrl !== undefined)   { sets.push(`slides_url = $${idx++}`);   params.push(input.slidesUrl); }
  if (input.videoUrl !== undefined)    { sets.push(`video_url = $${idx++}`);    params.push(input.videoUrl); }
  if (input.sortOrder !== undefined)   { sets.push(`sort_order = $${idx++}`);   params.push(input.sortOrder); }

  if (sets.length === 0) {
    const [row] = await db.query<SessionRow>(
      `SELECT * FROM conference.sessions WHERE id = $1`,
      [sessionId],
    );
    if (!row) throw new ConferenceError('SESSION_NOT_FOUND');
    return mapSession(row);
  }

  params.push(sessionId);
  const [row] = await db.query<SessionRow>(
    `UPDATE conference.sessions SET ${sets.join(', ')} WHERE id = $${idx} RETURNING *`,
    params,
  );
  if (!row) throw new ConferenceError('SESSION_NOT_FOUND');
  return mapSession(row);
}

// ---------------------------------------------------------------------------
// 4. listSessions
// ---------------------------------------------------------------------------

export async function listSessions(
  conferenceId: string,
  filters: ListSessionsFilters,
  db: SessionDB,
): Promise<Session[]> {
  const conditions: string[] = ['conference_id = $1'];
  const params: unknown[] = [conferenceId];
  let idx = 2;

  if (filters.dayId) {
    conditions.push(`day_id = $${idx++}`);
    params.push(filters.dayId);
  }
  if (filters.trackId) {
    conditions.push(`track_id = $${idx++}`);
    params.push(filters.trackId);
  }
  if (filters.sessionType) {
    conditions.push(`session_type = $${idx++}`);
    params.push(filters.sessionType);
  }

  const where = `WHERE ${conditions.join(' AND ')}`;
  const rows = await db.query<SessionRow>(
    `SELECT * FROM conference.sessions ${where} ORDER BY starts_at ASC, sort_order ASC`,
    params,
  );
  return rows.map(mapSession);
}

// ---------------------------------------------------------------------------
// 5. deleteSession
// ---------------------------------------------------------------------------

export async function deleteSession(
  sessionId: string,
  db: SessionDB,
): Promise<void> {
  await db.execute(
    `DELETE FROM conference.sessions WHERE id = $1`,
    [sessionId],
  );
}
