/**
 * Comprehensive tests for B2B API middleware:
 *  - authenticateApiKey (auth middleware)
 *  - requireScope (scope guard)
 *  - checkRateLimit / applyRateLimit (rate limiter)
 *  - generateApiKey utility
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  generateApiKey,
  VALID_SCOPES,
  ApiKeyService,
  ApiKeyError,
} from '../services/api-key.service.js';
import {
  checkRateLimit,
  applyRateLimit,
} from '../middleware/rate-limit.js';
import {
  authenticateApiKey,
  requireScope,
  errorResponse,
} from '../middleware/api-key-auth.js';
import type { ApiKeyContext } from '../middleware/api-key-auth.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeContext(overrides: Partial<ApiKeyContext> = {}): ApiKeyContext {
  return {
    keyId: 'key-001',
    promoterId: 'promo-001',
    scopes: ['read:events', 'read:orders'],
    tier: 'standard',
    environment: 'live',
    requestId: 'req-001',
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// generateApiKey
// ---------------------------------------------------------------------------

describe('generateApiKey', () => {
  it('live key starts with tick_live_', () => {
    const { raw, prefix, hash } = generateApiKey('live');
    expect(raw).toMatch(/^tick_live_[A-Za-z0-9_-]{20}$/);
    expect(prefix).toMatch(/^tick_live_/);
    expect(hash).toHaveLength(64); // SHA256 hex
  });

  it('test key starts with tick_test_', () => {
    const { raw } = generateApiKey('test');
    expect(raw).toMatch(/^tick_test_[A-Za-z0-9_-]{20}$/);
  });

  it('generates unique keys on every call', () => {
    const k1 = generateApiKey('live');
    const k2 = generateApiKey('live');
    expect(k1.raw).not.toBe(k2.raw);
    expect(k1.hash).not.toBe(k2.hash);
  });

  it('prefix is shorter than raw key', () => {
    const { raw, prefix } = generateApiKey('live');
    expect(prefix.length).toBeLessThan(raw.length);
  });
});

// ---------------------------------------------------------------------------
// VALID_SCOPES
// ---------------------------------------------------------------------------

describe('VALID_SCOPES', () => {
  it('contains all expected scopes', () => {
    expect(VALID_SCOPES).toContain('read:events');
    expect(VALID_SCOPES).toContain('write:orders');
    expect(VALID_SCOPES).toContain('admin:keys');
    expect(VALID_SCOPES).toContain('manage:webhooks');
    expect(VALID_SCOPES.length).toBe(8);
  });
});

// ---------------------------------------------------------------------------
// ApiKeyService
// ---------------------------------------------------------------------------

describe('ApiKeyService.create', () => {
  function makeDb() {
    return {
      createApiKey: vi.fn().mockResolvedValue({ id: 'key-001', createdAt: new Date() }),
      listApiKeys: vi.fn().mockResolvedValue([]),
      getApiKey: vi.fn().mockResolvedValue(null),
      revokeApiKey: vi.fn().mockResolvedValue(true),
      rotateApiKey: vi.fn().mockResolvedValue(null),
    };
  }

  it('rejects invalid scopes', async () => {
    const svc = new ApiKeyService(makeDb());
    await expect(svc.create({
      promoterId: 'p-1', name: 'test', scopes: ['invalid:scope'], environment: 'live',
    })).rejects.toThrow(ApiKeyError);
  });

  it('rejects empty scopes', async () => {
    const svc = new ApiKeyService(makeDb());
    await expect(svc.create({
      promoterId: 'p-1', name: 'test', scopes: [], environment: 'live',
    })).rejects.toThrow('Alespoň jeden scope');
  });

  it('creates key with correct tier default (free)', async () => {
    const db = makeDb();
    const svc = new ApiKeyService(db);
    const result = await svc.create({
      promoterId: 'p-1', name: 'test', scopes: ['read:events'], environment: 'live',
    });
    expect(result.tier).toBe('free');
    expect(result.rawKey).toMatch(/^tick_live_/);
  });

  it('creates key with premium tier', async () => {
    const db = makeDb();
    const svc = new ApiKeyService(db);
    const result = await svc.create({
      promoterId: 'p-1', name: 'premium', scopes: ['read:events'], environment: 'live', tier: 'premium',
    });
    expect(result.tier).toBe('premium');
  });

  it('stores IP whitelist when provided', async () => {
    const db = makeDb();
    const svc = new ApiKeyService(db);
    await svc.create({
      promoterId: 'p-1', name: 'restricted', scopes: ['read:events'],
      environment: 'live', ipWhitelist: ['192.168.1.1'],
    });
    expect(db.createApiKey).toHaveBeenCalledWith(
      expect.objectContaining({ ipWhitelist: ['192.168.1.1'] }),
    );
  });
});

describe('ApiKeyService.revoke', () => {
  it('throws when key not found', async () => {
    const db = {
      createApiKey: vi.fn(), listApiKeys: vi.fn(), getApiKey: vi.fn(),
      revokeApiKey: vi.fn().mockResolvedValue(false),
      rotateApiKey: vi.fn(),
    };
    const svc = new ApiKeyService(db);
    await expect(svc.revoke('missing', 'promo', 'test')).rejects.toThrow('API klíč nenalezen');
  });
});

describe('ApiKeyService.rotate', () => {
  it('returns new rawKey after rotation', async () => {
    const db = {
      createApiKey: vi.fn(), listApiKeys: vi.fn(), getApiKey: vi.fn(),
      revokeApiKey: vi.fn(),
      rotateApiKey: vi.fn().mockResolvedValue({
        newKeyPrefix: 'tick_live_abc123',
        newKeyHash: 'newhash',
        rawKey: 'tick_live_abc123fullkey12345678',
      }),
    };
    const svc = new ApiKeyService(db);
    const result = await svc.rotate('key-001', 'promo-001');
    expect(result.rawKey).toMatch(/^tick_live_/);
  });
});

// ---------------------------------------------------------------------------
// requireScope
// ---------------------------------------------------------------------------

describe('requireScope', () => {
  it('returns null when scope is present', () => {
    const ctx = makeContext({ scopes: ['read:events', 'write:orders'] });
    expect(requireScope(ctx, 'read:events')).toBeNull();
    expect(requireScope(ctx, 'write:orders')).toBeNull();
  });

  it('returns 403 response when scope is missing', () => {
    const ctx = makeContext({ scopes: ['read:events'] });
    const res = requireScope(ctx, 'write:orders');
    expect(res).not.toBeNull();
    expect(res?.status).toBe(403);
  });

  it('error response includes required scope name', async () => {
    const ctx = makeContext({ scopes: [] });
    const res = requireScope(ctx, 'admin:keys');
    const body = await res?.json();
    expect(body?.error?.code).toBe('INSUFFICIENT_SCOPE');
    expect(body?.error?.message).toContain('admin:keys');
  });
});

// ---------------------------------------------------------------------------
// errorResponse
// ---------------------------------------------------------------------------

describe('errorResponse', () => {
  it('returns JSON with error code and request_id', async () => {
    const res = errorResponse(429, 'RATE_LIMIT_EXCEEDED', 'Too many requests', 'req-abc');
    expect(res.status).toBe(429);
    const body = await res.json();
    expect(body.error.code).toBe('RATE_LIMIT_EXCEEDED');
    expect(body.error.request_id).toBe('req-abc');
    expect(body.error.message).toBe('Too many requests');
  });
});

// ---------------------------------------------------------------------------
// checkRateLimit
// ---------------------------------------------------------------------------

describe('checkRateLimit', () => {
  it('returns allowed=true when under limit', async () => {
    const mockPipeline = {
      zremrangebyscore: vi.fn(),
      zadd: vi.fn(),
      zcard: vi.fn(),
      expire: vi.fn(),
      exec: vi.fn().mockResolvedValue([
        [null, 1],   // zremrangebyscore
        [null, 1],   // zadd
        [null, 5],   // zcard → 5 requests
        [null, 1],   // expire
      ]),
    };

    // Inject mock redis into the module
    const { rateLimitRedis } = await import('../middleware/rate-limit.js');
    Object.assign(rateLimitRedis, { pipeline: () => mockPipeline });

    const ctx = makeContext({ tier: 'standard' }); // limit = 1000
    const result = await checkRateLimit(ctx);

    expect(result.allowed).toBe(true);
    expect(result.limit).toBe(1000);
    expect(result.remaining).toBe(995); // 1000 - 5
  });

  it('returns allowed=false when over limit', async () => {
    const mockPipeline = {
      zremrangebyscore: vi.fn(),
      zadd: vi.fn(),
      zcard: vi.fn(),
      expire: vi.fn(),
      exec: vi.fn().mockResolvedValue([
        [null, 0],
        [null, 1],
        [null, 1001], // over the 1000 limit
        [null, 1],
      ]),
    };

    const { rateLimitRedis } = await import('../middleware/rate-limit.js');
    Object.assign(rateLimitRedis, { pipeline: () => mockPipeline });

    const ctx = makeContext({ tier: 'standard' });
    const result = await checkRateLimit(ctx);

    expect(result.allowed).toBe(false);
    expect(result.remaining).toBe(0);
  });

  it('free tier has limit of 100 req/min', async () => {
    const mockPipeline = {
      zremrangebyscore: vi.fn(),
      zadd: vi.fn(),
      zcard: vi.fn(),
      expire: vi.fn(),
      exec: vi.fn().mockResolvedValue([
        [null, 0], [null, 1], [null, 50], [null, 1],
      ]),
    };
    const { rateLimitRedis } = await import('../middleware/rate-limit.js');
    Object.assign(rateLimitRedis, { pipeline: () => mockPipeline });

    const ctx = makeContext({ tier: 'free' });
    const result = await checkRateLimit(ctx);

    expect(result.limit).toBe(100);
    expect(result.remaining).toBe(50);
  });

  it('premium tier has limit of 10000 req/min', async () => {
    const mockPipeline = {
      zremrangebyscore: vi.fn(),
      zadd: vi.fn(),
      zcard: vi.fn(),
      expire: vi.fn(),
      exec: vi.fn().mockResolvedValue([
        [null, 0], [null, 1], [null, 100], [null, 1],
      ]),
    };
    const { rateLimitRedis } = await import('../middleware/rate-limit.js');
    Object.assign(rateLimitRedis, { pipeline: () => mockPipeline });

    const ctx = makeContext({ tier: 'premium' });
    const result = await checkRateLimit(ctx);

    expect(result.limit).toBe(10_000);
    expect(result.remaining).toBe(9_900);
  });
});

// ---------------------------------------------------------------------------
// applyRateLimit
// ---------------------------------------------------------------------------

describe('applyRateLimit', () => {
  it('returns headers object when under limit', async () => {
    const mockPipeline = {
      zremrangebyscore: vi.fn(), zadd: vi.fn(), zcard: vi.fn(), expire: vi.fn(),
      exec: vi.fn().mockResolvedValue([
        [null, 0], [null, 1], [null, 10], [null, 1],
      ]),
    };
    const { rateLimitRedis } = await import('../middleware/rate-limit.js');
    Object.assign(rateLimitRedis, { pipeline: () => mockPipeline });

    const ctx = makeContext({ tier: 'standard' });
    const result = await applyRateLimit(ctx);

    expect('headers' in result).toBe(true);
    if ('headers' in result) {
      expect(result.headers['X-RateLimit-Limit']).toBe('1000');
      expect(result.headers['X-RateLimit-Remaining']).toBeDefined();
    }
  });

  it('returns blocked 429 response when over limit', async () => {
    const mockPipeline = {
      zremrangebyscore: vi.fn(), zadd: vi.fn(), zcard: vi.fn(), expire: vi.fn(),
      exec: vi.fn().mockResolvedValue([
        [null, 0], [null, 1], [null, 1001], [null, 1],
      ]),
    };
    const { rateLimitRedis } = await import('../middleware/rate-limit.js');
    Object.assign(rateLimitRedis, { pipeline: () => mockPipeline });

    const ctx = makeContext({ tier: 'standard' });
    const result = await applyRateLimit(ctx);

    expect('blocked' in result).toBe(true);
    if ('blocked' in result) {
      expect(result.blocked.status).toBe(429);
    }
  });
});
