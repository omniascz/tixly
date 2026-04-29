// =============================================================================
// Virtual Waiting Room Service
// Feature #24: High-demand event queue with anti-bot and fair access
// Randomized priority scoring prevents bot advantage over real users.
// =============================================================================

import { randomUUID } from 'crypto';

export interface QueueConfig {
  id: string;
  eventId: string;
  promoterId: string;
  isActive: boolean;
  maxConcurrentUsers: number;
  entryRatePerMin: number;
  sessionTtlSeconds: number;
  randomizeEntry: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface QueueEntry {
  id: string;
  eventId: string;
  userId: string;
  sessionToken?: string;
  queuePosition?: number;
  status: 'waiting' | 'active' | 'expired' | 'completed';
  priorityScore: number;
  joinedAt: string;
  activatedAt?: string;
  expiresAt?: string;
  completedAt?: string;
}

export interface QueueStatus {
  position: number;
  waitingCount: number;
  activeCount: number;
  estimatedWaitMinutes: number;
  isActive: boolean;
  sessionToken?: string;
  expiresAt?: string;
}

export interface DbAdapter {
  query<T>(sql: string, params?: unknown[]): Promise<T[]>;
  execute(sql: string, params?: unknown[]): Promise<void>;
  transaction<T>(fn: (tx: DbAdapter) => Promise<T>): Promise<T>;
}

interface QueueConfigRow {
  id: string;
  event_id: string;
  promoter_id: string;
  is_active: boolean;
  max_concurrent_users: number;
  entry_rate_per_min: number;
  session_ttl_seconds: number;
  randomize_entry: boolean;
  created_at: string;
  updated_at: string;
}

interface QueueEntryRow {
  id: string;
  event_id: string;
  user_id: string;
  session_token: string | null;
  queue_position: number | null;
  status: string;
  priority_score: string;
  joined_at: string;
  activated_at: string | null;
  expires_at: string | null;
  completed_at: string | null;
}

function mapConfig(row: QueueConfigRow): QueueConfig {
  return {
    id: row.id,
    eventId: row.event_id,
    promoterId: row.promoter_id,
    isActive: row.is_active,
    maxConcurrentUsers: row.max_concurrent_users,
    entryRatePerMin: row.entry_rate_per_min,
    sessionTtlSeconds: row.session_ttl_seconds,
    randomizeEntry: row.randomize_entry,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function mapEntry(row: QueueEntryRow): QueueEntry {
  return {
    id: row.id,
    eventId: row.event_id,
    userId: row.user_id,
    sessionToken: row.session_token || undefined,
    queuePosition: row.queue_position || undefined,
    status: row.status as any,
    priorityScore: Number(row.priority_score),
    joinedAt: row.joined_at,
    activatedAt: row.activated_at || undefined,
    expiresAt: row.expires_at || undefined,
    completedAt: row.completed_at || undefined,
  };
}

/**
 * Create or activate a virtual waiting room for an event.
 */
export async function createQueue(
  eventId: string,
  promoterId: string,
  config: Partial<Omit<QueueConfig, 'id' | 'eventId' | 'promoterId' | 'createdAt' | 'updatedAt'>>,
  db: DbAdapter,
): Promise<QueueConfig> {
  const rows = await db.query<QueueConfigRow>(
    `INSERT INTO waiting_room.queues
       (event_id, promoter_id, is_active, max_concurrent_users, entry_rate_per_min, session_ttl_seconds, randomize_entry)
     VALUES ($1, $2, $3, $4, $5, $6, $7)
     ON CONFLICT (event_id)
     DO UPDATE SET
       is_active = COALESCE($3, is_active),
       max_concurrent_users = COALESCE($4, max_concurrent_users),
       entry_rate_per_min = COALESCE($5, entry_rate_per_min),
       session_ttl_seconds = COALESCE($6, session_ttl_seconds),
       randomize_entry = COALESCE($7, randomize_entry),
       updated_at = NOW()
     RETURNING *`,
    [
      eventId,
      promoterId,
      config.isActive ?? false,
      config.maxConcurrentUsers ?? 500,
      config.entryRatePerMin ?? 100,
      config.sessionTtlSeconds ?? 600,
      config.randomizeEntry ?? true,
    ],
  );

  if (!rows[0]) throw new Error('INTERNAL_ERROR: queue creation failed');
  return mapConfig(rows[0]);
}

/**
 * Join the waiting queue for an event.
 * Returns position and estimated wait time.
 * Anti-bot: priority score is randomized within registration time window.
 */
export async function joinQueue(
  eventId: string,
  userId: string,
  db: DbAdapter,
): Promise<QueueEntry> {
  if (!userId) throw new Error('VALIDATION_ERROR: userId required');

  // Anti-bot: add random noise to priority score so bots get no timing advantage
  const baseScore = Date.now();
  const noise = Math.random() * 10000;  // up to 10s of randomness
  const priorityScore = baseScore + noise;

  const rows = await db.query<QueueEntryRow>(
    `INSERT INTO waiting_room.queue_entries
       (event_id, user_id, priority_score, status)
     VALUES ($1, $2, $3, 'waiting')
     ON CONFLICT (event_id, user_id)
     DO UPDATE SET
       status = CASE WHEN queue_entries.status = 'expired' THEN 'waiting' ELSE queue_entries.status END
     RETURNING *`,
    [eventId, userId, priorityScore],
  );

  if (!rows[0]) throw new Error('INTERNAL_ERROR: queue join failed');
  return mapEntry(rows[0]);
}

/**
 * Get queue status for a user — position, wait time, session token if active.
 */
export async function getQueueStatus(
  eventId: string,
  userId: string,
  db: DbAdapter,
): Promise<QueueStatus> {
  const [config, entry] = await Promise.all([
    db.query<QueueConfigRow>(
      `SELECT * FROM waiting_room.queues WHERE event_id = $1`,
      [eventId],
    ),
    db.query<QueueEntryRow>(
      `SELECT * FROM waiting_room.queue_entries WHERE event_id = $1 AND user_id = $2`,
      [eventId, userId],
    ),
  ]);

  if (!entry[0]) {
    return {
      position: 0,
      waitingCount: 0,
      activeCount: 0,
      estimatedWaitMinutes: 0,
      isActive: false,
    };
  }

  const myEntry = entry[0];
  const queueConfig = config[0];

  // Count users ahead in queue
  const countsResult = await db.query<{ waiting_count: string; active_count: string }>(
    `SELECT
       COUNT(*) FILTER (WHERE status = 'waiting' AND priority_score < $2) AS waiting_count,
       COUNT(*) FILTER (WHERE status = 'active') AS active_count
     FROM waiting_room.queue_entries WHERE event_id = $1`,
    [eventId, myEntry.priority_score],
  );

  const waitingAhead = Number(countsResult[0]?.waiting_count ?? 0);
  const activeCount = Number(countsResult[0]?.active_count ?? 0);

  // Estimate wait time based on entry rate
  const entryRate = queueConfig?.entry_rate_per_min ?? 100;
  const estimatedWaitMinutes = Math.ceil(waitingAhead / entryRate);

  return {
    position: waitingAhead + 1,
    waitingCount: waitingAhead,
    activeCount,
    estimatedWaitMinutes,
    isActive: myEntry.status === 'active',
    sessionToken: myEntry.session_token || undefined,
    expiresAt: myEntry.expires_at || undefined,
  };
}

/**
 * Advance the queue — activate next batch of users.
 * Called periodically by a scheduler (every minute).
 */
export async function advanceQueue(
  eventId: string,
  db: DbAdapter,
): Promise<number> {
  return db.transaction(async (tx) => {
    const configRows = await tx.query<QueueConfigRow>(
      `SELECT * FROM waiting_room.queues WHERE event_id = $1 AND is_active = true`,
      [eventId],
    );
    if (!configRows[0]) return 0;

    const config = configRows[0];
    const { max_concurrent_users, entry_rate_per_min, session_ttl_seconds } = config;

    // Count currently active sessions
    const activeResult = await tx.query<{ count: string }>(
      `SELECT COUNT(*) AS count FROM waiting_room.queue_entries
       WHERE event_id = $1 AND status = 'active' AND expires_at > NOW()`,
      [eventId],
    );
    const activeCount = Number(activeResult[0]?.count ?? 0);
    const slots = Math.max(0, max_concurrent_users - activeCount);
    const toActivate = Math.min(slots, entry_rate_per_min);

    if (toActivate === 0) return 0;

    // Expire sessions whose time is up
    await tx.execute(
      `UPDATE waiting_room.queue_entries
       SET status = 'expired'
       WHERE event_id = $1 AND status = 'active' AND expires_at <= NOW()`,
      [eventId],
    );

    // Activate next users in priority order
    const activated = await tx.query<{ id: string }>(
      `UPDATE waiting_room.queue_entries
       SET
         status = 'active',
         session_token = gen_random_uuid()::text,
         activated_at = NOW(),
         expires_at = NOW() + ($2 * interval '1 second')
       WHERE id IN (
         SELECT id FROM waiting_room.queue_entries
         WHERE event_id = $1 AND status = 'waiting'
         ORDER BY priority_score ASC
         LIMIT $3
       )
       RETURNING id`,
      [eventId, session_ttl_seconds, toActivate],
    );

    return activated.length;
  });
}

/**
 * Validate a session token — check if user has an active buying window.
 */
export async function validateSession(
  eventId: string,
  sessionToken: string,
  db: DbAdapter,
): Promise<QueueEntry | null> {
  const rows = await db.query<QueueEntryRow>(
    `SELECT * FROM waiting_room.queue_entries
     WHERE event_id = $1 AND session_token = $2 AND status = 'active' AND expires_at > NOW()`,
    [eventId, sessionToken],
  );
  return rows[0] ? mapEntry(rows[0]) : null;
}

/**
 * Complete a session after successful purchase.
 */
export async function completeSession(
  eventId: string,
  sessionToken: string,
  db: DbAdapter,
): Promise<void> {
  await db.execute(
    `UPDATE waiting_room.queue_entries
     SET status = 'completed', completed_at = NOW()
     WHERE event_id = $1 AND session_token = $2`,
    [eventId, sessionToken],
  );
}

/**
 * Activate the waiting room for an event (open the queue).
 */
export async function activateQueue(
  eventId: string,
  db: DbAdapter,
): Promise<void> {
  await db.execute(
    `UPDATE waiting_room.queues SET is_active = true, updated_at = NOW()
     WHERE event_id = $1`,
    [eventId],
  );
}

/**
 * Deactivate the waiting room (close the queue — event sold out or ended).
 */
export async function deactivateQueue(
  eventId: string,
  db: DbAdapter,
): Promise<void> {
  await db.execute(
    `UPDATE waiting_room.queues SET is_active = false, updated_at = NOW()
     WHERE event_id = $1`,
    [eventId],
  );
}

/**
 * Get queue config for an event.
 */
export async function getQueueConfig(
  eventId: string,
  db: DbAdapter,
): Promise<QueueConfig | null> {
  const rows = await db.query<QueueConfigRow>(
    `SELECT * FROM waiting_room.queues WHERE event_id = $1`,
    [eventId],
  );
  return rows[0] ? mapConfig(rows[0]) : null;
}
