import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  checkDb,
  checkRedis,
  checkExternalApi,
  runHealthChecks,
  buildHealthReport,
  healthHttpStatus,
  aggregateStatus,
} from '../services/health.service.js';
import type { DbAdapter, CacheAdapter, HttpAdapter, ComponentHealth } from '../lib/types.js';

// ─── Mock factories ───────────────────────────────────────────────────────────

function makeDb(opts: { fail?: boolean; delayMs?: number } = {}): DbAdapter {
  return {
    query: vi.fn(async () => {
      if (opts.delayMs) await new Promise(r => setTimeout(r, opts.delayMs));
      if (opts.fail) throw new Error('Connection refused');
      return [{ ok: 1 }];
    }),
  };
}

function makeCache(opts: { fail?: boolean; pong?: string; writeReadFail?: boolean } = {}): CacheAdapter {
  const store = new Map<string, string>();
  return {
    ping: vi.fn(async () => {
      if (opts.fail) throw new Error('ECONNREFUSED');
      return opts.pong ?? 'PONG';
    }),
    set: vi.fn(async (key, value) => { store.set(key, value); }),
    get: vi.fn(async (key) => {
      if (opts.writeReadFail) return null;
      return store.get(key) ?? null;
    }),
  };
}

function makeHttp(opts: { status?: number; fail?: boolean } = {}): HttpAdapter {
  return {
    get: vi.fn(async () => {
      if (opts.fail) throw new Error('Network error');
      const status = opts.status ?? 200;
      return { status, ok: status >= 200 && status < 300 };
    }),
  };
}

// ─── checkDb ─────────────────────────────────────────────────────────────────

describe('checkDb', () => {
  it('returns healthy when DB responds quickly', async () => {
    const db = makeDb();
    const result = await checkDb(db, 'postgresql');

    expect(result.status).toBe('healthy');
    expect(result.name).toBe('postgresql');
    expect(result.responseTimeMs).toBeGreaterThanOrEqual(0);
  });

  it('returns unhealthy when DB throws', async () => {
    const db = makeDb({ fail: true });
    const result = await checkDb(db);

    expect(result.status).toBe('unhealthy');
    expect(result.message).toContain('Connection refused');
  });

  it('returns unhealthy on timeout', async () => {
    const db = makeDb({ delayMs: 200 });
    const result = await checkDb(db, 'postgresql', 50); // 50ms timeout

    expect(result.status).toBe('unhealthy');
    expect(result.message).toContain('timeout');
  });

  it('uses custom name', async () => {
    const db = makeDb();
    const result = await checkDb(db, 'read-replica');
    expect(result.name).toBe('read-replica');
  });
});

// ─── checkRedis ───────────────────────────────────────────────────────────────

describe('checkRedis', () => {
  it('returns healthy when Redis responds PONG', async () => {
    const cache = makeCache();
    const result = await checkRedis(cache);

    expect(result.status).toBe('healthy');
    expect(result.name).toBe('redis');
  });

  it('returns unhealthy when ping throws', async () => {
    const cache = makeCache({ fail: true });
    const result = await checkRedis(cache);

    expect(result.status).toBe('unhealthy');
    expect(result.message).toContain('ECONNREFUSED');
  });

  it('returns unhealthy when PING returns wrong value', async () => {
    const cache = makeCache({ pong: 'NOT_PONG' });
    const result = await checkRedis(cache);

    expect(result.status).toBe('unhealthy');
    expect(result.message).toContain('NOT_PONG');
  });

  it('returns degraded when write/read probe fails', async () => {
    const cache = makeCache({ writeReadFail: true });
    const result = await checkRedis(cache);

    expect(result.status).toBe('degraded');
    expect(result.message).toContain('probe failed');
  });

  it('uses custom name', async () => {
    const cache = makeCache();
    const result = await checkRedis(cache, 'redis-replica');
    expect(result.name).toBe('redis-replica');
  });
});

// ─── checkExternalApi ─────────────────────────────────────────────────────────

describe('checkExternalApi', () => {
  it('returns healthy for 200 OK', async () => {
    const http = makeHttp({ status: 200 });
    const result = await checkExternalApi(http, 'https://api.gopay.cz/health', 'gopay');

    expect(result.status).toBe('healthy');
    expect(result.name).toBe('gopay');
    expect(result.details?.['url']).toBe('https://api.gopay.cz/health');
  });

  it('treats 401 as healthy (API reachable, auth expected)', async () => {
    const http = makeHttp({ status: 401 });
    const result = await checkExternalApi(http, 'https://api.stripe.com/v1', 'stripe');

    expect(result.status).toBe('healthy');
  });

  it('treats 403 as healthy (API reachable)', async () => {
    const http = makeHttp({ status: 403 });
    const result = await checkExternalApi(http, 'https://api.example.com', 'example');
    expect(result.status).toBe('healthy');
  });

  it('returns unhealthy for 500', async () => {
    const http = makeHttp({ status: 500 });
    const result = await checkExternalApi(http, 'https://api.gopay.cz/health', 'gopay');

    expect(result.status).toBe('unhealthy');
    expect(result.message).toContain('500');
  });

  it('returns unhealthy on network error', async () => {
    const http = makeHttp({ fail: true });
    const result = await checkExternalApi(http, 'https://api.gopay.cz/health', 'gopay');

    expect(result.status).toBe('unhealthy');
    expect(result.message).toContain('Network error');
  });
});

// ─── runHealthChecks ──────────────────────────────────────────────────────────

describe('runHealthChecks', () => {
  it('runs all checks in parallel and returns results', async () => {
    const checks = [
      { name: 'db', check: () => checkDb(makeDb()) },
      { name: 'redis', check: () => checkRedis(makeCache()) },
    ];

    const results = await runHealthChecks(checks);

    expect(results).toHaveLength(2);
    expect(results[0].status).toBe('healthy');
    expect(results[1].status).toBe('healthy');
  });

  it('one failing check does not block others', async () => {
    const checks = [
      { name: 'db', check: () => checkDb(makeDb()) },
      { name: 'redis', check: () => checkRedis(makeCache({ fail: true })) },
      { name: 'http', check: () => checkExternalApi(makeHttp(), 'https://example.com', 'example') },
    ];

    const results = await runHealthChecks(checks);

    expect(results).toHaveLength(3);
    expect(results[0].status).toBe('healthy');
    expect(results[1].status).toBe('unhealthy');
    expect(results[2].status).toBe('healthy');
  });

  it('handles unexpected errors gracefully', async () => {
    const checks = [
      {
        name: 'broken',
        check: async (): Promise<ComponentHealth> => { throw new Error('unexpected'); },
      },
    ];

    const results = await runHealthChecks(checks);
    expect(results[0].status).toBe('unhealthy');
  });
});

// ─── aggregateStatus ──────────────────────────────────────────────────────────

describe('aggregateStatus', () => {
  it('returns healthy when all components healthy', () => {
    const components: ComponentHealth[] = [
      { name: 'db', status: 'healthy', responseTimeMs: 5 },
      { name: 'redis', status: 'healthy', responseTimeMs: 2 },
    ];
    expect(aggregateStatus(components)).toBe('healthy');
  });

  it('returns degraded when any component is degraded', () => {
    const components: ComponentHealth[] = [
      { name: 'db', status: 'healthy', responseTimeMs: 5 },
      { name: 'redis', status: 'degraded', responseTimeMs: 800 },
    ];
    expect(aggregateStatus(components)).toBe('degraded');
  });

  it('returns unhealthy when any component is unhealthy', () => {
    const components: ComponentHealth[] = [
      { name: 'db', status: 'healthy', responseTimeMs: 5 },
      { name: 'redis', status: 'degraded', responseTimeMs: 800 },
      { name: 'gopay', status: 'unhealthy', responseTimeMs: 5000, message: 'timeout' },
    ];
    expect(aggregateStatus(components)).toBe('unhealthy');
  });

  it('unhealthy beats degraded', () => {
    const components: ComponentHealth[] = [
      { name: 'a', status: 'degraded', responseTimeMs: 100 },
      { name: 'b', status: 'unhealthy', responseTimeMs: 100 },
    ];
    expect(aggregateStatus(components)).toBe('unhealthy');
  });
});

// ─── buildHealthReport ────────────────────────────────────────────────────────

describe('buildHealthReport', () => {
  it('includes all required fields', () => {
    const components: ComponentHealth[] = [
      { name: 'db', status: 'healthy', responseTimeMs: 10 },
    ];

    const report = buildHealthReport(components, { version: '1.2.3', environment: 'production' });

    expect(report.status).toBe('healthy');
    expect(report.version).toBe('1.2.3');
    expect(report.environment).toBe('production');
    expect(typeof report.timestamp).toBe('string');
    expect(report.timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(report.uptimeSeconds).toBeGreaterThanOrEqual(0);
    expect(report.components).toEqual(components);
  });

  it('overall status reflects worst component', () => {
    const components: ComponentHealth[] = [
      { name: 'db', status: 'healthy', responseTimeMs: 5 },
      { name: 'gopay', status: 'unhealthy', responseTimeMs: 5000 },
    ];

    const report = buildHealthReport(components);
    expect(report.status).toBe('unhealthy');
  });

  it('uses process.env fallbacks when options not provided', () => {
    const components: ComponentHealth[] = [];
    const report = buildHealthReport(components);
    expect(typeof report.version).toBe('string');
    expect(typeof report.environment).toBe('string');
  });
});

// ─── healthHttpStatus ─────────────────────────────────────────────────────────

describe('healthHttpStatus', () => {
  it('returns 200 for healthy', () => {
    const report = buildHealthReport([{ name: 'db', status: 'healthy', responseTimeMs: 5 }]);
    expect(healthHttpStatus(report)).toBe(200);
  });

  it('returns 200 for degraded', () => {
    const report = buildHealthReport([{ name: 'db', status: 'degraded', responseTimeMs: 1500 }]);
    expect(healthHttpStatus(report)).toBe(200);
  });

  it('returns 503 for unhealthy', () => {
    const report = buildHealthReport([{ name: 'db', status: 'unhealthy', responseTimeMs: 5000 }]);
    expect(healthHttpStatus(report)).toBe(503);
  });
});
