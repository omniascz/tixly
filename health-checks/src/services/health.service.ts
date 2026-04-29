// =============================================================================
// Health Check Service
//
// Poskytuje:
//   checkDb         — ping PostgreSQL (SELECT 1)
//   checkRedis      — ping Redis (PING → PONG)
//   checkExternalApi — HTTP GET na external service
//   runHealthChecks  — paralelní spuštění všech checků
//   buildHealthReport — sestavení /health response
//   aggregateStatus  — výsledný status = nejhorší ze všech komponent
//
// Integrace s BetterStack / UptimeRobot: endpoint vrátí HTTP 200 pro healthy/degraded,
// HTTP 503 pro unhealthy — monitoring services poznají výpadek.
// =============================================================================

import type {
  HealthStatus,
  ComponentHealth,
  HealthReport,
  HealthCheckOptions,
  DbAdapter,
  CacheAdapter,
  HttpAdapter,
} from '../lib/types.js';

const PROCESS_START = Date.now();

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function aggregateStatus(components: ComponentHealth[]): HealthStatus {
  if (components.some(c => c.status === 'unhealthy')) return 'unhealthy';
  if (components.some(c => c.status === 'degraded')) return 'degraded';
  return 'healthy';
}

async function timed<T>(fn: () => Promise<T>): Promise<{ result: T; elapsedMs: number }> {
  const start = Date.now();
  const result = await fn();
  return { result, elapsedMs: Date.now() - start };
}

// ---------------------------------------------------------------------------
// Individual checks
// ---------------------------------------------------------------------------

/**
 * PostgreSQL health check via SELECT 1.
 */
export async function checkDb(
  db: DbAdapter,
  name = 'postgresql',
  timeoutMs = 3000,
): Promise<ComponentHealth> {
  try {
    const { elapsedMs } = await Promise.race([
      timed(() => db.query('SELECT 1 as ok')),
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error('DB health check timeout')), timeoutMs),
      ),
    ]);

    const status: HealthStatus = elapsedMs > 1000 ? 'degraded' : 'healthy';
    return { name, status, responseTimeMs: elapsedMs };
  } catch (err) {
    return {
      name,
      status: 'unhealthy',
      responseTimeMs: timeoutMs,
      message: (err as Error).message,
    };
  }
}

/**
 * Redis health check via PING → PONG.
 * Also verifies read/write with a probe key.
 */
export async function checkRedis(
  cache: CacheAdapter,
  name = 'redis',
  timeoutMs = 3000,
): Promise<ComponentHealth> {
  try {
    const { result: pong, elapsedMs } = await Promise.race([
      timed(() => cache.ping()),
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error('Redis health check timeout')), timeoutMs),
      ),
    ]);

    if (pong !== 'PONG') {
      return { name, status: 'unhealthy', responseTimeMs: elapsedMs, message: `Unexpected PING response: ${pong}` };
    }

    // Write/read probe
    const probeKey = `health:probe:${Date.now()}`;
    await cache.set(probeKey, '1', 5);
    const val = await cache.get(probeKey);

    if (val !== '1') {
      return { name, status: 'degraded', responseTimeMs: elapsedMs, message: 'Redis write/read probe failed' };
    }

    const status: HealthStatus = elapsedMs > 500 ? 'degraded' : 'healthy';
    return { name, status, responseTimeMs: elapsedMs };
  } catch (err) {
    return {
      name,
      status: 'unhealthy',
      responseTimeMs: timeoutMs,
      message: (err as Error).message,
    };
  }
}

/**
 * External API health check via HTTP GET.
 * Used for: GoPay, Stripe, BulkGate, Wero, P24, etc.
 */
export async function checkExternalApi(
  http: HttpAdapter,
  url: string,
  name: string,
  timeoutMs = 5000,
): Promise<ComponentHealth> {
  try {
    const { result, elapsedMs } = await Promise.race([
      timed(() => http.get(url, timeoutMs)),
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error(`${name} health check timeout`)), timeoutMs),
      ),
    ]);

    if (!result.ok && result.status !== 401 && result.status !== 403) {
      // 401/403 = reachable but auth required → API is up
      return {
        name,
        status: 'unhealthy',
        responseTimeMs: elapsedMs,
        message: `HTTP ${result.status}`,
        details: { url, status: result.status },
      };
    }

    const status: HealthStatus = elapsedMs > 2000 ? 'degraded' : 'healthy';
    return { name, status, responseTimeMs: elapsedMs, details: { url, status: result.status } };
  } catch (err) {
    return {
      name,
      status: 'unhealthy',
      responseTimeMs: timeoutMs,
      message: (err as Error).message,
      details: { url },
    };
  }
}

// ---------------------------------------------------------------------------
// Aggregator
// ---------------------------------------------------------------------------

export interface CheckDefinition {
  name: string;
  check: () => Promise<ComponentHealth>;
}

/**
 * Runs all health checks in parallel and returns individual results.
 * Failures in one check do not block others.
 */
export async function runHealthChecks(
  checks: CheckDefinition[],
): Promise<ComponentHealth[]> {
  return Promise.all(checks.map(async ({ check }) => {
    try {
      return await check();
    } catch (err) {
      return {
        name: 'unknown',
        status: 'unhealthy' as HealthStatus,
        responseTimeMs: 0,
        message: `Unexpected error: ${(err as Error).message}`,
      };
    }
  }));
}

/**
 * Builds the full /health response payload.
 * HTTP status: 200 for healthy/degraded, 503 for unhealthy.
 */
export function buildHealthReport(
  components: ComponentHealth[],
  options: HealthCheckOptions = {},
): HealthReport {
  const status = aggregateStatus(components);
  return {
    status,
    version: options.version ?? process.env['APP_VERSION'] ?? 'unknown',
    environment: options.environment ?? process.env['NODE_ENV'] ?? 'production',
    timestamp: new Date().toISOString(),
    uptimeSeconds: Math.floor((Date.now() - PROCESS_START) / 1000),
    components,
  };
}

/**
 * HTTP status code for /health endpoint.
 * BetterStack / UptimeRobot: 503 triggers alert.
 */
export function healthHttpStatus(report: HealthReport): number {
  return report.status === 'unhealthy' ? 503 : 200;
}

// Re-export aggregateStatus for use in tests and other modules
export { aggregateStatus };
