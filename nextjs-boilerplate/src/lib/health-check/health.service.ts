/**
 * Health check service for monitoring database, Redis, and external APIs
 * Provides comprehensive system health status for monitoring tools
 */

import { type Client as PgClient } from 'pg';
import {
  type DatabaseHealthResponse,
  type ExternalApiCheck,
  type ExternalApiCheckRequest,
  type HealthStatus,
  type RedisHealthResponse,
  type ServiceHealth,
  type SystemHealth,
} from './types';

const DB_TIMEOUT_MS = 1000; // Warn if > 1s
const REDIS_TIMEOUT_MS = 100; // Warn if > 100ms
const EXTERNAL_TIMEOUT_MS = 5000; // Default external API timeout
const EXTERNAL_SLOW_THRESHOLD_MS = 1000; // Warn if > 1s

/**
 * Check database connection health
 * @param db PostgreSQL client
 * @returns Health status with response time
 */
export async function checkDatabaseHealth(
  db?: PgClient,
): Promise<DatabaseHealthResponse> {
  if (!db) {
    return {
      status: 'error',
      responseTime: 0,
      error: 'Database client not initialized',
    };
  }

  const startTime = performance.now();
  try {
    await db.query('SELECT 1');
    const responseTime = Math.round(performance.now() - startTime);

    return {
      status: responseTime > DB_TIMEOUT_MS ? 'slow' : 'ok',
      responseTime,
    };
  } catch (error) {
    const responseTime = Math.round(performance.now() - startTime);
    return {
      status: 'error',
      responseTime,
      error: error instanceof Error ? error.message : 'Database check failed',
    };
  }
}

/**
 * Check Redis connection health
 * @param redis Redis client (any type to avoid dependency on redis package)
 * @returns Health status with response time
 */
export async function checkRedisHealth(
  redis?: any,
): Promise<RedisHealthResponse> {
  if (!redis) {
    return {
      status: 'error',
      responseTime: 0,
      error: 'Redis client not initialized',
    };
  }

  const startTime = performance.now();
  try {
    await redis.ping();
    const responseTime = Math.round(performance.now() - startTime);

    return {
      status: responseTime > REDIS_TIMEOUT_MS ? 'slow' : 'ok',
      responseTime,
    };
  } catch (error) {
    const responseTime = Math.round(performance.now() - startTime);
    return {
      status: 'error',
      responseTime,
      error: error instanceof Error ? error.message : 'Redis check failed',
    };
  }
}

/**
 * Check external API availability
 * @param url API URL to check
 * @param timeout Timeout in milliseconds (default 5000)
 * @returns Health status with response time
 */
export async function checkExternalApi(
  url: string,
  timeout: number = EXTERNAL_TIMEOUT_MS,
): Promise<ExternalApiCheck> {
  const startTime = performance.now();
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeout);

  try {
    // Try HEAD request first (lighter weight)
    const response = await fetch(url, {
      method: 'HEAD',
      signal: controller.signal,
    }).catch(() =>
      // Fallback to GET if HEAD fails
      fetch(url, { method: 'GET', signal: controller.signal }),
    );

    const responseTime = Math.round(performance.now() - startTime);

    if (!response.ok && response.status >= 500) {
      return {
        url,
        status: 'error',
        responseTime,
        error: `HTTP ${response.status}`,
      };
    }

    return {
      url,
      status: responseTime > EXTERNAL_SLOW_THRESHOLD_MS ? 'slow' : 'ok',
      responseTime,
    };
  } catch (error) {
    const responseTime = Math.round(performance.now() - startTime);
    const isTimeout = error instanceof Error && error.name === 'AbortError';

    return {
      url,
      status: 'error',
      responseTime,
      error: isTimeout ? 'Timeout' : error instanceof Error ? error.message : 'Request failed',
    };
  } finally {
    clearTimeout(timeoutId);
  }
}

/**
 * Check external APIs in parallel
 * @param request Batch request with URLs
 * @returns Array of API check results
 */
export async function checkExternalApis(
  request: ExternalApiCheckRequest,
): Promise<ExternalApiCheck[]> {
  const timeout = request.timeout || EXTERNAL_TIMEOUT_MS;
  const promises = request.urls.map((url) => checkExternalApi(url, timeout));
  return Promise.all(promises);
}

/**
 * Calculate overall system health status
 * @param services Service health results
 * @returns Overall health status
 */
export function calculateOverallStatus(services: ServiceHealth[]): HealthStatus {
  if (services.length === 0) {
    return 'healthy';
  }

  const hasUnhealthy = services.some((s) => s.status === 'unhealthy');
  if (hasUnhealthy) {
    return 'unhealthy';
  }

  const hasDegraded = services.some((s) => s.status === 'degraded');
  if (hasDegraded) {
    return 'degraded';
  }

  return 'healthy';
}

/**
 * Determine service health status from checks
 * @param checks Health check results
 * @returns Service health status
 */
export function determineServiceStatus(checks: {
  db?: DatabaseHealthResponse;
  redis?: RedisHealthResponse;
  external?: ExternalApiCheck[];
}): HealthStatus {
  let hasError = false;
  let hasSlow = false;

  // Check database
  if (checks.db) {
    if (checks.db.status === 'error') hasError = true;
    if (checks.db.status === 'slow') hasSlow = true;
  }

  // Check Redis
  if (checks.redis) {
    if (checks.redis.status === 'error') hasError = true;
    if (checks.redis.status === 'slow') hasSlow = true;
  }

  // Check external APIs
  if (checks.external && checks.external.length > 0) {
    const externalErrors = checks.external.filter((c) => c.status === 'error');
    const externalSlow = checks.external.filter((c) => c.status === 'slow');

    // If all external APIs error, mark as degraded
    if (externalErrors.length === checks.external.length && checks.external.length > 0) {
      hasSlow = true;
    } else if (externalErrors.length > 0) {
      hasSlow = true;
    }

    if (externalSlow.length > 0) {
      hasSlow = true;
    }
  }

  if (hasError) return 'unhealthy';
  if (hasSlow) return 'degraded';
  return 'healthy';
}

/**
 * Get comprehensive system health status
 * @param db PostgreSQL client (optional)
 * @param redis Redis client (optional, any type to avoid dependency)
 * @param externalApis External APIs to check (optional)
 * @returns Complete system health information
 */
export async function getSystemHealth(
  db?: PgClient,
  redis?: any,
  externalApis?: string[],
): Promise<SystemHealth> {
  const timestamp = new Date().toISOString();
  const systemStartTime = performance.now();

  // Run all checks in parallel
  const [dbHealth, redisHealth, externalChecks] = await Promise.all([
    checkDatabaseHealth(db),
    checkRedisHealth(redis),
    externalApis && externalApis.length > 0
      ? checkExternalApis({ urls: externalApis })
      : Promise.resolve([] as ExternalApiCheck[]),
  ]);

  const totalResponseTime = Math.round(performance.now() - systemStartTime);

  // Build service health entries
  const services: ServiceHealth[] = [];

  // Database service
  if (db) {
    services.push({
      name: 'database',
      status:
        dbHealth.status === 'error'
          ? 'unhealthy'
          : dbHealth.status === 'slow'
            ? 'degraded'
            : 'healthy',
      responseTime: dbHealth.responseTime,
      checks: { db: dbHealth },
      error: dbHealth.error,
    });
  }

  // Redis service
  if (redis) {
    services.push({
      name: 'redis',
      status:
        redisHealth.status === 'error'
          ? 'unhealthy'
          : redisHealth.status === 'slow'
            ? 'degraded'
            : 'healthy',
      responseTime: redisHealth.responseTime,
      checks: { redis: redisHealth },
      error: redisHealth.error,
    });
  }

  // External APIs service
  if (externalChecks.length > 0) {
    const externalStatus = determineExternalApiStatus(externalChecks);
    services.push({
      name: 'external_apis',
      status: externalStatus,
      responseTime: Math.max(...externalChecks.map((c) => c.responseTime), 0),
      checks: { external: externalChecks },
      error:
        externalChecks.length > 0
          ? externalChecks
              .filter((c) => c.error)
              .map((c) => `${c.url}: ${c.error}`)
              .join('; ')
          : undefined,
    });
  }

  // Calculate overall status
  const status = calculateOverallStatus(services);

  return {
    status,
    timestamp,
    totalResponseTime,
    services,
  };
}

/**
 * Determine overall status for external API checks
 * @param checks External API check results
 * @returns Overall health status
 */
function determineExternalApiStatus(checks: ExternalApiCheck[]): HealthStatus {
  if (checks.length === 0) return 'healthy';

  const hasError = checks.some((c) => c.status === 'error');
  const hasSlow = checks.some((c) => c.status === 'slow');

  // If any API is down, it's degraded
  if (hasError) return 'degraded';
  if (hasSlow) return 'degraded';

  return 'healthy';
}
