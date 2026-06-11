/**
 * Redis-backed virtual queue.
 *
 * Klíče:
 *   queue:{eventId}:waiting   ZSET (score = joined_at_unix_ms, member = tokenId)
 *   queue:{eventId}:admitted  ZSET (score = expires_at_unix_ms, member = tokenId)
 *   queue:token:{tokenId}     HASH { eventId, status, joinedAt }
 *
 * Operace:
 *   joinQueue(eventId, tokenId)        → ZADD waiting (NX + score=NOW)
 *   getStatus(eventId, tokenId)        → ZSCORE/ZRANK + check admitted
 *   admitNext(eventId, max, ttlSec)    → atomic Lua: pop oldest waiting → ZADD admitted
 *   completeAdmission(eventId, tokenId) → ZREM admitted
 *
 * Pokud Redis nedostupný (REDIS_URL=NONE nebo connect fail), `redisAvailable()` vrátí false
 * a volající fallbackuje na DB-based queue (Phase H.1).
 */

import { createClient, type RedisClientType } from 'redis';

let client: RedisClientType | null = null;
let connectPromise: Promise<RedisClientType | null> | null = null;
let lastConnectAttempt = 0;
const CONNECT_RETRY_MS = 30_000;

export async function getClient(): Promise<RedisClientType | null> {
  if (process.env.REDIS_URL === 'NONE' || !process.env.REDIS_URL) {
    return null;
  }
  if (client && client.isOpen) return client;
  if (connectPromise) return connectPromise;
  // Backoff
  if (Date.now() - lastConnectAttempt < CONNECT_RETRY_MS) return null;
  lastConnectAttempt = Date.now();

  connectPromise = (async () => {
    try {
      const c = createClient({ url: process.env.REDIS_URL }) as RedisClientType;
      c.on('error', (err) => console.error('[redis-queue]', err));
      await c.connect();
      client = c;
      return c;
    } catch (err) {
      console.error('[redis-queue] connect failed:', err);
      return null;
    } finally {
      connectPromise = null;
    }
  })();
  return connectPromise;
}

export async function redisAvailable(): Promise<boolean> {
  const c = await getClient();
  return c !== null && c.isOpen;
}

export async function joinQueueRedis(eventId: string, tokenId: string): Promise<void> {
  const c = await getClient();
  if (!c) throw new Error('Redis unavailable');
  const score = Date.now();
  await c.zAdd(
    `queue:${eventId}:waiting`,
    { score, value: tokenId },
    { NX: true },
  );
}

export interface QueuePosition {
  status: 'waiting' | 'admitted' | 'expired' | 'not_found';
  position?: number;
  ahead?: number;
  expiresAt?: number;
}

export async function getQueueStatusRedis(
  eventId: string,
  tokenId: string,
): Promise<QueuePosition> {
  const c = await getClient();
  if (!c) throw new Error('Redis unavailable');

  // Admitted? Check expiry.
  const admittedScore = await c.zScore(`queue:${eventId}:admitted`, tokenId);
  if (admittedScore !== null) {
    if (admittedScore <= Date.now()) {
      // Expired — remove
      await c.zRem(`queue:${eventId}:admitted`, tokenId);
      return { status: 'expired' };
    }
    return { status: 'admitted', expiresAt: admittedScore };
  }

  // Waiting? Get rank
  const rank = await c.zRank(`queue:${eventId}:waiting`, tokenId);
  if (rank === null) {
    return { status: 'not_found' };
  }
  return { status: 'waiting', position: rank + 1, ahead: rank };
}

/**
 * Atomic: pop up to `max` oldest waiting tokens, move to admitted with TTL.
 * Returns admitted token IDs.
 */
export async function admitNextRedis(
  eventId: string,
  max: number,
  ttlSec: number,
): Promise<string[]> {
  const c = await getClient();
  if (!c) throw new Error('Redis unavailable');
  if (max <= 0) return [];

  // Lua skript pro atomic pop-and-promote
  const script = `
    local waitingKey = KEYS[1]
    local admittedKey = KEYS[2]
    local max = tonumber(ARGV[1])
    local expiresAt = tonumber(ARGV[2])
    local tokens = redis.call('ZRANGE', waitingKey, 0, max - 1)
    if #tokens == 0 then return {} end
    redis.call('ZREMRANGEBYRANK', waitingKey, 0, #tokens - 1)
    for i, tok in ipairs(tokens) do
      redis.call('ZADD', admittedKey, expiresAt, tok)
    end
    return tokens
  `;
  const expiresAt = Date.now() + ttlSec * 1000;
  const result = (await c.eval(script, {
    keys: [`queue:${eventId}:waiting`, `queue:${eventId}:admitted`],
    arguments: [String(max), String(expiresAt)],
  })) as string[];
  return result;
}

export async function completeAdmissionRedis(
  eventId: string,
  tokenId: string,
): Promise<void> {
  const c = await getClient();
  if (!c) throw new Error('Redis unavailable');
  await c.zRem(`queue:${eventId}:admitted`, tokenId);
}

export async function getActiveCountRedis(eventId: string): Promise<number> {
  const c = await getClient();
  if (!c) throw new Error('Redis unavailable');
  // Cleanup expired first
  await c.zRemRangeByScore(`queue:${eventId}:admitted`, 0, Date.now());
  return c.zCard(`queue:${eventId}:admitted`);
}
