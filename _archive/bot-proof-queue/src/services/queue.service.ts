import { randomUUID } from 'crypto';
import type { DbAdapter, QueueEntry } from '../lib/types.js';

const QUEUE_TTL_MS = 30 * 60 * 1000; // 30 minutes
const AVG_PROCESSING_RATE = 10; // entries per minute

interface QueueEntryRow {
  id: string;
  event_id: string;
  session_id: string;
  ip_address: string;
  user_agent: string | null;
  fingerprint_hash: string | null;
  position: number;
  status: string;
  challenge_token: string | null;
  challenge_expires_at: string | null;
  admitted_at: string | null;
  created_at: string;
  expires_at: string;
}

function mapRow(row: QueueEntryRow): QueueEntry {
  return {
    id: row.id,
    eventId: row.event_id,
    sessionId: row.session_id,
    ipAddress: row.ip_address,
    userAgent: row.user_agent ?? undefined,
    fingerprintHash: row.fingerprint_hash ?? undefined,
    position: row.position,
    status: row.status as QueueEntry['status'],
    challengeToken: row.challenge_token ?? undefined,
    challengeExpiresAt: row.challenge_expires_at ?? undefined,
    admittedAt: row.admitted_at ?? undefined,
    createdAt: row.created_at,
    expiresAt: row.expires_at,
  };
}

export async function joinQueue(
  eventId: string,
  sessionId: string,
  ipAddress: string,
  db: DbAdapter,
  options?: { userAgent?: string; fingerprintHash?: string },
): Promise<QueueEntry> {
  // Return existing entry if already in queue
  const existing = await db.query<QueueEntryRow>(
    `SELECT * FROM bot_proof_queue WHERE event_id = $1 AND session_id = $2 LIMIT 1`,
    [eventId, sessionId],
  );

  if (existing.length > 0) {
    return mapRow(existing[0]);
  }

  // Get next position
  const posResult = await db.query<{ max_pos: number | null }>(
    `SELECT MAX(position) as max_pos FROM bot_proof_queue WHERE event_id = $1`,
    [eventId],
  );
  const nextPosition = (posResult[0]?.max_pos ?? 0) + 1;

  const id = randomUUID();
  const now = new Date();
  const createdAt = now.toISOString();
  const expiresAt = new Date(now.getTime() + QUEUE_TTL_MS).toISOString();

  await db.execute(
    `INSERT INTO bot_proof_queue
       (id, event_id, session_id, ip_address, user_agent, fingerprint_hash, position, status, created_at, expires_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, 'waiting', $8, $9)`,
    [
      id,
      eventId,
      sessionId,
      ipAddress,
      options?.userAgent ?? null,
      options?.fingerprintHash ?? null,
      nextPosition,
      createdAt,
      expiresAt,
    ],
  );

  return {
    id,
    eventId,
    sessionId,
    ipAddress,
    userAgent: options?.userAgent,
    fingerprintHash: options?.fingerprintHash,
    position: nextPosition,
    status: 'waiting',
    createdAt,
    expiresAt,
  };
}

export async function getQueuePosition(
  sessionId: string,
  eventId: string,
  db: DbAdapter,
): Promise<{ position: number; estimatedWaitMinutes: number }> {
  const rows = await db.query<QueueEntryRow>(
    `SELECT * FROM bot_proof_queue WHERE event_id = $1 AND session_id = $2 LIMIT 1`,
    [eventId, sessionId],
  );

  if (rows.length === 0) {
    throw new Error('QUEUE_ENTRY_NOT_FOUND');
  }

  const entry = rows[0];
  const position = entry.position;
  const estimatedWaitMinutes = Math.ceil(position / AVG_PROCESSING_RATE);

  return { position, estimatedWaitMinutes };
}

export async function admitFromQueue(
  eventId: string,
  count: number,
  db: DbAdapter,
): Promise<number> {
  const candidates = await db.query<QueueEntryRow>(
    `SELECT * FROM bot_proof_queue
     WHERE event_id = $1 AND status IN ('waiting', 'verified')
     ORDER BY position ASC
     LIMIT $2`,
    [eventId, count],
  );

  const admittedAt = new Date().toISOString();

  for (const entry of candidates) {
    await db.execute(
      `UPDATE bot_proof_queue SET status = 'admitted', admitted_at = $1 WHERE id = $2`,
      [admittedAt, entry.id],
    );
  }

  return candidates.length;
}

export async function markVerified(entryId: string, db: DbAdapter): Promise<void> {
  await db.execute(
    `UPDATE bot_proof_queue SET status = 'verified' WHERE id = $1`,
    [entryId],
  );
}

export async function rejectEntry(
  entryId: string,
  reason: string,
  db: DbAdapter,
): Promise<void> {
  await db.execute(
    `UPDATE bot_proof_queue SET status = 'rejected' WHERE id = $1`,
    [entryId, reason],
  );
}

export async function cleanupExpired(db: DbAdapter): Promise<number> {
  const now = new Date().toISOString();

  const expired = await db.query<{ id: string }>(
    `SELECT id FROM bot_proof_queue
     WHERE expires_at < $1 AND status NOT IN ('admitted', 'rejected', 'expired')`,
    [now],
  );

  for (const row of expired) {
    await db.execute(
      `UPDATE bot_proof_queue SET status = 'expired' WHERE id = $1`,
      [row.id],
    );
  }

  return expired.length;
}

export async function getQueueLength(eventId: string, db: DbAdapter): Promise<number> {
  const result = await db.query<{ count: string }>(
    `SELECT COUNT(*) as count FROM bot_proof_queue
     WHERE event_id = $1 AND status IN ('waiting', 'verified')`,
    [eventId],
  );
  return parseInt(result[0]?.count ?? '0', 10);
}
