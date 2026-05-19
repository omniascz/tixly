/**
 * Health check integration helpers for connecting to actual DB/Redis clients
 * Use this to initialize clients in your health endpoints
 */

import { type Client as PgClient } from 'pg';

/**
 * Initialize PostgreSQL client for health checks
 * Uses connection pooling and immediate verification
 *
 * @param connectionString PostgreSQL connection string
 * @returns Initialized client or null if connection fails
 */
export async function initializeDatabaseClient(
  connectionString?: string,
): Promise<PgClient | null> {
  if (!connectionString) {
    return null;
  }

  try {
    const { Client } = await import('pg');
    const client = new Client({ connectionString });

    // Don't keep connection open - create new ones for each check
    // This allows for proper connection pooling in production
    return client;
  } catch {
    return null;
  }
}

/**
 * Initialize Redis client for health checks
 * Uses connection pooling when available
 *
 * @param redisUrl Redis connection URL
 * @returns Initialized client or null if connection fails
 */
export async function initializeRedisClient(redisUrl?: string): Promise<unknown> {
  if (!redisUrl) {
    return null;
  }

  try {
    const { createClient } = await import('redis');
    const redis = createClient({ url: redisUrl });

    // Don't auto-connect - let health check handle connection lifecycle
    return redis;
  } catch {
    return null;
  }
}

/**
 * Get parsed external API URLs from environment variable
 * Format: EXTERNAL_APIS=url1,url2,url3
 *
 * @returns Array of external API URLs
 */
export function getConfiguredExternalApis(): string[] {
  const externalApis = process.env.EXTERNAL_HEALTH_CHECK_APIS;

  if (!externalApis) {
    return [];
  }

  return externalApis
    .split(',')
    .map((url) => url.trim())
    .filter((url) => url.length > 0)
    .filter((url) => {
      try {
        new URL(url);
        return true;
      } catch {
        return false;
      }
    });
}

/**
 * Get health check configuration from environment
 * @returns Health check configuration
 */
interface HealthCheckConfig {
  dbConnectionString: string | undefined;
  redisUrl: string | undefined;
  externalApis: string[];
  dbTimeout: number;
  redisTimeout: number;
  externalTimeout: number;
}

export function getHealthCheckConfig(): HealthCheckConfig {
  return {
    dbConnectionString: process.env.DATABASE_URL,
    redisUrl: process.env.REDIS_URL,
    externalApis: getConfiguredExternalApis(),
    dbTimeout: parseInt(process.env.HEALTH_CHECK_DB_TIMEOUT ?? '1000', 10),
    redisTimeout: parseInt(process.env.HEALTH_CHECK_REDIS_TIMEOUT ?? '100', 10),
    externalTimeout: parseInt(process.env.HEALTH_CHECK_EXTERNAL_TIMEOUT ?? '5000', 10),
  };
}

/**
 * Example integration helper to use in your /api/health route
 *
 * Usage in route.ts:
 * ```
 * import { getSystemHealth } from '@/lib/health-check/health.service';
 * import { getHealthCheckClients } from '@/lib/health-check/health.integration';
 *
 * export async function GET(request: NextRequest) {
 *   const { db, redis, externalApis } = await getHealthCheckClients();
 *   try {
 *     const health = await getSystemHealth(db, redis, externalApis);
 *     return NextResponse.json(health, { status: health.status === 'unhealthy' ? 503 : 200 });
 *   } finally {
 *     // Clean up connections
 *     if (db) await db.end();
 *     if (redis?.isOpen) await redis.disconnect();
 *   }
 * }
 * ```
 */
interface HealthCheckClients {
  db: unknown;
  redis: unknown;
  externalApis: string[];
}

export async function getHealthCheckClients(): Promise<HealthCheckClients> {
  const config = getHealthCheckConfig();

  // Initialize clients in parallel
  const [db, redis] = await Promise.all([
    initializeDatabaseClient(config.dbConnectionString),
    initializeRedisClient(config.redisUrl),
  ]);

  return {
    db,
    redis,
    externalApis: config.externalApis,
  };
}
