// =============================================================================
// DB klient — PostgreSQL pool (pg) + Redis klient (ioredis)
// =============================================================================

import { Pool } from "pg";
import Redis from "ioredis";

// ---------------------------------------------------------------------------
// PostgreSQL pool
// ---------------------------------------------------------------------------

declare global {
  // eslint-disable-next-line no-var
  var __pgPool: Pool | undefined;
}

function createPool(): Pool {
  return new Pool({
    connectionString: process.env["DATABASE_URL"],
    max: 10,
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 5_000,
    // Nastavení role pro RLS bypass (service role pro dashboard backend)
    // Každý dotaz musí volat SET LOCAL app.role = 'service' v transakci
  });
}

// Singleton pool — přes Next.js hot reload
export const db: Pool = global.__pgPool ?? createPool();
if (process.env["NODE_ENV"] !== "production") {
  global.__pgPool = db;
}

// ---------------------------------------------------------------------------
// Redis klient
// ---------------------------------------------------------------------------

declare global {
  // eslint-disable-next-line no-var
  var __redisClient: Redis | undefined;
}

function createRedis(): Redis {
  const client = new Redis(process.env["REDIS_URL"] ?? "redis://localhost:6379", {
    maxRetriesPerRequest: 3,
    lazyConnect: true,
  });
  client.on("error", (err: Error) => {
    console.error("[Redis]", err.message);
  });
  return client;
}

export const redis: Redis = global.__redisClient ?? createRedis();
if (process.env["NODE_ENV"] !== "production") {
  global.__redisClient = redis;
}

// ---------------------------------------------------------------------------
// Helper: spusť dotaz se service role (bypass RLS)
// ---------------------------------------------------------------------------

export async function queryAsService<T extends object>(
  sql: string,
  params: (string | number | boolean | null | Date)[] = []
): Promise<T[]> {
  const client = await db.connect();
  try {
    await client.query("SET LOCAL app.role = 'service'");
    const result = await client.query<T>(sql, params);
    return result.rows;
  } finally {
    client.release();
  }
}

// ---------------------------------------------------------------------------
// Redis cache helper
// ---------------------------------------------------------------------------

export async function getOrSetCache<T>(
  key: string,
  ttlSeconds: number,
  fetcher: () => Promise<T>
): Promise<{ data: T; cached: boolean }> {
  try {
    const cached = await redis.get(key);
    if (cached !== null) {
      return { data: JSON.parse(cached) as T, cached: true };
    }
  } catch {
    // Redis nedostupný — pokračuj bez cache
  }

  const data = await fetcher();

  try {
    await redis.set(key, JSON.stringify(data), "EX", ttlSeconds);
  } catch {
    // Redis nedostupný — ignoruj
  }

  return { data, cached: false };
}
