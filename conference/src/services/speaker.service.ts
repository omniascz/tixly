// =============================================================================
// Speaker Service
//
// Covers: speaker profiles, assigning speakers to sessions
// DB schema: conference.speakers, conference.session_speakers
// =============================================================================

import { ConferenceError, isPgUniqueViolation } from '../lib/conference-errors';

// ---------------------------------------------------------------------------
// DB adapter
// ---------------------------------------------------------------------------

export interface SpeakerDB {
  query<T>(sql: string, params?: unknown[]): Promise<T[]>;
  execute(sql: string, params?: unknown[]): Promise<void>;
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface CreateSpeakerInput {
  fullName: string;
  bio?: string;
  photoUrl?: string;
  company?: string;
  title?: string;
  linkedinUrl?: string;
  twitterHandle?: string;
  websiteUrl?: string;
}

export interface UpdateSpeakerInput {
  fullName?: string;
  bio?: string;
  photoUrl?: string;
  company?: string;
  title?: string;
  linkedinUrl?: string;
  twitterHandle?: string;
  websiteUrl?: string;
}

export interface Speaker {
  id: string;
  promoterId: string;
  fullName: string;
  bio: string | null;
  photoUrl: string | null;
  company: string | null;
  title: string | null;
  linkedinUrl: string | null;
  twitterHandle: string | null;
  websiteUrl: string | null;
  createdAt: string;
}

export interface SessionSpeakerAssignment {
  id: string;
  sessionId: string;
  speakerId: string;
  role: string;
  sortOrder: number;
}

// ---------------------------------------------------------------------------
// Row types
// ---------------------------------------------------------------------------

interface SpeakerRow {
  id: string;
  promoter_id: string;
  full_name: string;
  bio: string | null;
  photo_url: string | null;
  company: string | null;
  title: string | null;
  linkedin_url: string | null;
  twitter_handle: string | null;
  website_url: string | null;
  created_at: string;
}

interface SessionSpeakerRow {
  id: string;
  session_id: string;
  speaker_id: string;
  role: string;
  sort_order: number;
}

// ---------------------------------------------------------------------------
// Mapper
// ---------------------------------------------------------------------------

function mapSpeaker(row: SpeakerRow): Speaker {
  return {
    id: row.id,
    promoterId: row.promoter_id,
    fullName: row.full_name,
    bio: row.bio,
    photoUrl: row.photo_url,
    company: row.company,
    title: row.title,
    linkedinUrl: row.linkedin_url,
    twitterHandle: row.twitter_handle,
    websiteUrl: row.website_url,
    createdAt: row.created_at,
  };
}

function mapAssignment(row: SessionSpeakerRow): SessionSpeakerAssignment {
  return {
    id: row.id,
    sessionId: row.session_id,
    speakerId: row.speaker_id,
    role: row.role,
    sortOrder: row.sort_order,
  };
}

// ---------------------------------------------------------------------------
// 1. createSpeaker
// ---------------------------------------------------------------------------

export async function createSpeaker(
  promoterId: string,
  input: CreateSpeakerInput,
  db: SpeakerDB,
): Promise<Speaker> {
  try {
    const [row] = await db.query<SpeakerRow>(
      `INSERT INTO conference.speakers
         (promoter_id, full_name, bio, photo_url, company, title,
          linkedin_url, twitter_handle, website_url)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
       RETURNING *`,
      [
        promoterId,
        input.fullName,
        input.bio ?? null,
        input.photoUrl ?? null,
        input.company ?? null,
        input.title ?? null,
        input.linkedinUrl ?? null,
        input.twitterHandle ?? null,
        input.websiteUrl ?? null,
      ],
    );
    return mapSpeaker(row);
  } catch (err: unknown) {
    if (isPgUniqueViolation(err)) {
      throw new ConferenceError('SPEAKER_DUPLICATE');
    }
    throw err;
  }
}

// ---------------------------------------------------------------------------
// 2. getSpeaker
// ---------------------------------------------------------------------------

export async function getSpeaker(
  speakerId: string,
  db: SpeakerDB,
): Promise<Speaker> {
  const [row] = await db.query<SpeakerRow>(
    `SELECT * FROM conference.speakers WHERE id = $1`,
    [speakerId],
  );
  if (!row) throw new ConferenceError('SPEAKER_NOT_FOUND');
  return mapSpeaker(row);
}

// ---------------------------------------------------------------------------
// 3. listSpeakers
// ---------------------------------------------------------------------------

export async function listSpeakers(
  promoterId: string,
  db: SpeakerDB,
): Promise<Speaker[]> {
  const rows = await db.query<SpeakerRow>(
    `SELECT * FROM conference.speakers WHERE promoter_id = $1 ORDER BY full_name ASC`,
    [promoterId],
  );
  return rows.map(mapSpeaker);
}

// ---------------------------------------------------------------------------
// 4. updateSpeaker
// ---------------------------------------------------------------------------

export async function updateSpeaker(
  speakerId: string,
  input: UpdateSpeakerInput,
  db: SpeakerDB,
): Promise<Speaker> {
  const sets: string[] = [];
  const params: unknown[] = [];
  let idx = 1;

  if (input.fullName !== undefined)     { sets.push(`full_name = $${idx++}`);      params.push(input.fullName); }
  if (input.bio !== undefined)          { sets.push(`bio = $${idx++}`);             params.push(input.bio); }
  if (input.photoUrl !== undefined)     { sets.push(`photo_url = $${idx++}`);       params.push(input.photoUrl); }
  if (input.company !== undefined)      { sets.push(`company = $${idx++}`);         params.push(input.company); }
  if (input.title !== undefined)        { sets.push(`title = $${idx++}`);           params.push(input.title); }
  if (input.linkedinUrl !== undefined)  { sets.push(`linkedin_url = $${idx++}`);    params.push(input.linkedinUrl); }
  if (input.twitterHandle !== undefined){ sets.push(`twitter_handle = $${idx++}`);  params.push(input.twitterHandle); }
  if (input.websiteUrl !== undefined)   { sets.push(`website_url = $${idx++}`);     params.push(input.websiteUrl); }

  if (sets.length === 0) {
    return getSpeaker(speakerId, db);
  }

  params.push(speakerId);
  const [row] = await db.query<SpeakerRow>(
    `UPDATE conference.speakers SET ${sets.join(', ')} WHERE id = $${idx} RETURNING *`,
    params,
  );
  if (!row) throw new ConferenceError('SPEAKER_NOT_FOUND');
  return mapSpeaker(row);
}

// ---------------------------------------------------------------------------
// 5. assignSpeakerToSession
// ---------------------------------------------------------------------------

export async function assignSpeakerToSession(
  sessionId: string,
  speakerId: string,
  role: 'speaker' | 'moderator' | 'panelist',
  sortOrder: number,
  db: SpeakerDB,
): Promise<SessionSpeakerAssignment> {
  const [row] = await db.query<SessionSpeakerRow>(
    `INSERT INTO conference.session_speakers (session_id, speaker_id, role, sort_order)
     VALUES ($1, $2, $3, $4)
     RETURNING *`,
    [sessionId, speakerId, role, sortOrder],
  );
  return mapAssignment(row);
}

// ---------------------------------------------------------------------------
// 6. removeSpeakerFromSession
// ---------------------------------------------------------------------------

export async function removeSpeakerFromSession(
  sessionId: string,
  speakerId: string,
  db: SpeakerDB,
): Promise<void> {
  await db.execute(
    `DELETE FROM conference.session_speakers WHERE session_id = $1 AND speaker_id = $2`,
    [sessionId, speakerId],
  );
}
