// =============================================================================
// Conference Service
//
// Covers: conferences, days, tracks, schedule
// DB schema: conference.*
// =============================================================================

import { ConferenceError } from '../lib/conference-errors';

// ---------------------------------------------------------------------------
// DB adapter
// ---------------------------------------------------------------------------

export interface ConferenceDB {
  query<T>(sql: string, params?: unknown[]): Promise<T[]>;
  execute(sql: string, params?: unknown[]): Promise<void>;
}

export interface ConferenceDeps {
  db: ConferenceDB;
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface CreateConferenceInput {
  eventId: string;
  subtitle?: string;
  venueMapUrl?: string;
  websiteUrl?: string;
  codeOfConductUrl?: string;
  language?: string;
  timezone?: string;
}

export interface Conference {
  id: string;
  eventId: string;
  subtitle: string | null;
  venueMapUrl: string | null;
  websiteUrl: string | null;
  codeOfConductUrl: string | null;
  language: string;
  timezone: string;
  createdAt: string;
}

export interface ConferenceWithStats extends Conference {
  daysCount: number;
  sessionsCount: number;
}

export interface AddDayInput {
  dayDate: string;
  label: string;
  description?: string;
  sortOrder?: number;
}

export interface ConferenceDay {
  id: string;
  conferenceId: string;
  dayDate: string;
  label: string;
  description: string | null;
  sortOrder: number;
}

export interface AddTrackInput {
  name: string;
  color?: string;
  description?: string;
  sortOrder?: number;
}

export interface ConferenceTrack {
  id: string;
  conferenceId: string;
  name: string;
  color: string | null;
  description: string | null;
  sortOrder: number;
}

export interface SessionSpeakerRow {
  id: string;
  fullName: string;
  role: string;
  sortOrder: number;
}

export interface ScheduleSession {
  id: string;
  title: string;
  description: string | null;
  sessionType: string;
  startsAt: string;
  endsAt: string;
  room: string | null;
  capacity: number | null;
  isRecorded: boolean;
  trackId: string | null;
  slidesUrl: string | null;
  videoUrl: string | null;
  sortOrder: number;
  speakers: SessionSpeakerRow[];
}

export interface ScheduleDay {
  id: string;
  dayDate: string;
  label: string;
  description: string | null;
  sortOrder: number;
  sessions: ScheduleSession[];
}

export interface ConferenceSchedule extends Conference {
  days: ScheduleDay[];
}

// ---------------------------------------------------------------------------
// Row types
// ---------------------------------------------------------------------------

interface ConferenceRow {
  id: string;
  event_id: string;
  subtitle: string | null;
  venue_map_url: string | null;
  website_url: string | null;
  code_of_conduct_url: string | null;
  language: string;
  timezone: string;
  created_at: string;
}

interface ConferenceStatsRow extends ConferenceRow {
  days_count: string;
  sessions_count: string;
}

interface DayRow {
  id: string;
  conference_id: string;
  day_date: string;
  label: string;
  description: string | null;
  sort_order: number;
}

interface TrackRow {
  id: string;
  conference_id: string;
  name: string;
  color: string | null;
  description: string | null;
  sort_order: number;
}

interface SessionWithSpeakersRow {
  id: string;
  title: string;
  description: string | null;
  session_type: string;
  starts_at: string;
  ends_at: string;
  room: string | null;
  capacity: number | null;
  is_recorded: boolean;
  track_id: string | null;
  slides_url: string | null;
  video_url: string | null;
  sort_order: number;
  day_id: string;
  speakers: string | null; // JSON array from aggregation
}

// ---------------------------------------------------------------------------
// Mappers
// ---------------------------------------------------------------------------

function mapConference(row: ConferenceRow): Conference {
  return {
    id: row.id,
    eventId: row.event_id,
    subtitle: row.subtitle,
    venueMapUrl: row.venue_map_url,
    websiteUrl: row.website_url,
    codeOfConductUrl: row.code_of_conduct_url,
    language: row.language,
    timezone: row.timezone,
    createdAt: row.created_at,
  };
}

function mapDay(row: DayRow): ConferenceDay {
  return {
    id: row.id,
    conferenceId: row.conference_id,
    dayDate: row.day_date,
    label: row.label,
    description: row.description,
    sortOrder: row.sort_order,
  };
}

function mapTrack(row: TrackRow): ConferenceTrack {
  return {
    id: row.id,
    conferenceId: row.conference_id,
    name: row.name,
    color: row.color,
    description: row.description,
    sortOrder: row.sort_order,
  };
}

// ---------------------------------------------------------------------------
// 1. createConference
// ---------------------------------------------------------------------------

export async function createConference(
  input: CreateConferenceInput,
  db: ConferenceDB,
): Promise<Conference> {
  const [row] = await db.query<ConferenceRow>(
    `INSERT INTO conference.conferences
       (event_id, subtitle, venue_map_url, website_url, code_of_conduct_url, language, timezone)
     VALUES ($1, $2, $3, $4, $5, $6, $7)
     RETURNING *`,
    [
      input.eventId,
      input.subtitle ?? null,
      input.venueMapUrl ?? null,
      input.websiteUrl ?? null,
      input.codeOfConductUrl ?? null,
      input.language ?? 'cs',
      input.timezone ?? 'Europe/Prague',
    ],
  );
  return mapConference(row);
}

// ---------------------------------------------------------------------------
// 2. getConference
// ---------------------------------------------------------------------------

export async function getConference(
  conferenceId: string,
  db: ConferenceDB,
): Promise<ConferenceWithStats> {
  const [row] = await db.query<ConferenceStatsRow>(
    `SELECT c.*,
       (SELECT COUNT(*) FROM conference.days d WHERE d.conference_id = c.id) AS days_count,
       (SELECT COUNT(*) FROM conference.sessions s WHERE s.conference_id = c.id) AS sessions_count
     FROM conference.conferences c
     WHERE c.id = $1`,
    [conferenceId],
  );
  if (!row) throw new ConferenceError('CONFERENCE_NOT_FOUND');
  return {
    ...mapConference(row),
    daysCount: parseInt(row.days_count ?? '0', 10),
    sessionsCount: parseInt(row.sessions_count ?? '0', 10),
  };
}

// ---------------------------------------------------------------------------
// 3. addDay
// ---------------------------------------------------------------------------

export async function addDay(
  conferenceId: string,
  input: AddDayInput,
  db: ConferenceDB,
): Promise<ConferenceDay> {
  const [row] = await db.query<DayRow>(
    `INSERT INTO conference.days
       (conference_id, day_date, label, description, sort_order)
     VALUES ($1, $2, $3, $4, $5)
     RETURNING *`,
    [
      conferenceId,
      input.dayDate,
      input.label,
      input.description ?? null,
      input.sortOrder ?? 0,
    ],
  );
  return mapDay(row);
}

// ---------------------------------------------------------------------------
// 4. addTrack
// ---------------------------------------------------------------------------

export async function addTrack(
  conferenceId: string,
  input: AddTrackInput,
  db: ConferenceDB,
): Promise<ConferenceTrack> {
  const [row] = await db.query<TrackRow>(
    `INSERT INTO conference.tracks
       (conference_id, name, color, description, sort_order)
     VALUES ($1, $2, $3, $4, $5)
     RETURNING *`,
    [
      conferenceId,
      input.name,
      input.color ?? null,
      input.description ?? null,
      input.sortOrder ?? 0,
    ],
  );
  return mapTrack(row);
}

// ---------------------------------------------------------------------------
// 5. getSchedule
// ---------------------------------------------------------------------------

export async function getSchedule(
  conferenceId: string,
  db: ConferenceDB,
): Promise<ConferenceSchedule> {
  // 1) Conference
  const [confRow] = await db.query<ConferenceRow>(
    `SELECT * FROM conference.conferences WHERE id = $1`,
    [conferenceId],
  );
  if (!confRow) throw new ConferenceError('CONFERENCE_NOT_FOUND');

  // 2) Days
  const days = await db.query<DayRow>(
    `SELECT * FROM conference.days WHERE conference_id = $1 ORDER BY sort_order ASC, day_date ASC`,
    [conferenceId],
  );

  // 3) Sessions with speakers (as JSON)
  const sessions = await db.query<SessionWithSpeakersRow>(
    `SELECT s.*,
       COALESCE(
         json_agg(
           json_build_object(
             'id', sp.id,
             'fullName', sp.full_name,
             'role', ss.role,
             'sortOrder', ss.sort_order
           ) ORDER BY ss.sort_order
         ) FILTER (WHERE sp.id IS NOT NULL),
         '[]'
       ) AS speakers
     FROM conference.sessions s
     LEFT JOIN conference.session_speakers ss ON ss.session_id = s.id
     LEFT JOIN conference.speakers sp ON sp.id = ss.speaker_id
     WHERE s.conference_id = $1
     GROUP BY s.id
     ORDER BY s.starts_at ASC`,
    [conferenceId],
  );

  // Build day map
  const dayMap = new Map<string, ScheduleDay>();
  for (const d of days) {
    dayMap.set(d.id, {
      id: d.id,
      dayDate: d.day_date,
      label: d.label,
      description: d.description,
      sortOrder: d.sort_order,
      sessions: [],
    });
  }

  // Assign sessions to days
  for (const s of sessions) {
    const day = dayMap.get(s.day_id);
    let parsedSpeakers: SessionSpeakerRow[] = [];
    if (s.speakers) {
      try {
        parsedSpeakers = typeof s.speakers === 'string'
          ? JSON.parse(s.speakers)
          : (s.speakers as unknown as SessionSpeakerRow[]);
      } catch {
        parsedSpeakers = [];
      }
    }
    const sessionObj: ScheduleSession = {
      id: s.id,
      title: s.title,
      description: s.description,
      sessionType: s.session_type,
      startsAt: s.starts_at,
      endsAt: s.ends_at,
      room: s.room,
      capacity: s.capacity,
      isRecorded: s.is_recorded,
      trackId: s.track_id,
      slidesUrl: s.slides_url,
      videoUrl: s.video_url,
      sortOrder: s.sort_order,
      speakers: parsedSpeakers,
    };
    if (day) {
      day.sessions.push(sessionObj);
    }
  }

  return {
    ...mapConference(confRow),
    days: Array.from(dayMap.values()),
  };
}
