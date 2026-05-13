// =============================================================================
// @tixly/rate-limiter — unit tests
// =============================================================================

import { describe, it, expect, beforeEach } from 'vitest';
import {
  checkRateLimit,
  extractRateLimitKey,
  RATE_LIMITS,
  checkTenantRateLimit,
  TENANT_RATE_LIMITS,
} from '../index.js';
import type { RedisLike, RateLimitConfig, SlidingWindowRedis, TenantRateLimitConfig } from '../index.js';

// ---------------------------------------------------------------------------
// In-memory Redis mock
// ---------------------------------------------------------------------------

class MockRedis implements RedisLike {
  private counters = new Map<string, number>();
  private expiries = new Map<string, number>(); // stores TTL in seconds from "now"
  private createdAt = new Map<string, number>(); // wall-clock ms at creation

  async incr(key: string): Promise<number> {
    const current = this.counters.get(key) ?? 0;
    const next = current + 1;
    this.counters.set(key, next);
    if (!this.createdAt.has(key)) {
      this.createdAt.set(key, Date.now());
    }
    return next;
  }

  async expire(key: string, seconds: number): Promise<void> {
    this.expiries.set(key, seconds);
    this.createdAt.set(key, Date.now());
  }

  async ttl(key: string): Promise<number> {
    const windowSeconds = this.expiries.get(key);
    if (!windowSeconds) return -1;
    const created = this.createdAt.get(key) ?? Date.now();
    const elapsed = (Date.now() - created) / 1000;
    return Math.max(0, Math.round(windowSeconds - elapsed));
  }

  /** Test helper: reset a key (simulate TTL expiry) */
  reset(key: string): void {
    this.counters.delete(key);
    this.expiries.delete(key);
    this.createdAt.delete(key);
  }

  /** Test helper: fast-forward time by advancing createdAt backwards */
  expireKey(key: string): void {
    this.counters.delete(key);
    this.expiries.delete(key);
    this.createdAt.delete(key);
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeConfig(overrides?: Partial<RateLimitConfig>): RateLimitConfig {
  return { limit: 5, windowSeconds: 60, prefix: 'test', ...overrides };
}

function makeRequest(headers: Record<string, string> = {}): Request {
  return new Request('https://example.com/api/test', { headers });
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('checkRateLimit', () => {
  let redis: MockRedis;

  beforeEach(() => {
    redis = new MockRedis();
  });

  it('case 1 — request under limit is allowed', async () => {
    const config = makeConfig({ limit: 5 });
    const result = await checkRateLimit(redis, 'user:alice', config);

    expect(result.allowed).toBe(true);
    expect(result.remaining).toBe(4); // limit 5, count 1 → 4 remaining
    expect(result.retryAfterSeconds).toBeNull();
    expect(result.resetAt).toBeInstanceOf(Date);
  });

  it('case 2 — request exactly at limit is still allowed', async () => {
    const config = makeConfig({ limit: 3 });
    const key = 'user:bob';

    // Exhaust to limit
    for (let i = 0; i < 2; i++) {
      await checkRateLimit(redis, key, config);
    }
    const result = await checkRateLimit(redis, key, config); // 3rd request = at limit

    expect(result.allowed).toBe(true);
    expect(result.remaining).toBe(0);
    expect(result.retryAfterSeconds).toBeNull();
  });

  it('case 3 — request over limit is denied with retryAfter', async () => {
    const config = makeConfig({ limit: 2 });
    const key = 'ip:1.2.3.4';

    // Use up the limit
    await checkRateLimit(redis, key, config);
    await checkRateLimit(redis, key, config);

    // This one should be denied
    const result = await checkRateLimit(redis, key, config);

    expect(result.allowed).toBe(false);
    expect(result.remaining).toBe(0);
    expect(result.retryAfterSeconds).not.toBeNull();
    expect(result.retryAfterSeconds).toBeGreaterThan(0);
  });

  it('case 4 — TTL expiry resets the counter', async () => {
    const config = makeConfig({ limit: 2 });
    const key = 'ip:5.6.7.8';

    // Exceed limit
    await checkRateLimit(redis, key, config);
    await checkRateLimit(redis, key, config);
    const denied = await checkRateLimit(redis, key, config);
    expect(denied.allowed).toBe(false);

    // Simulate TTL expiry by resetting the mock
    redis.expireKey(`${config.prefix}:${key}`);

    // Should be allowed again after reset
    const result = await checkRateLimit(redis, key, config);
    expect(result.allowed).toBe(true);
    expect(result.remaining).toBe(1);
  });
});

describe('extractRateLimitKey', () => {
  it('case 5 — priority: API key > user ID > IP', () => {
    // API key takes precedence over everything
    const withAll = makeRequest({
      'x-api-key': 'secret-key-123',
      'x-user-id': 'user-uuid',
      'x-forwarded-for': '10.0.0.1',
    });
    expect(extractRateLimitKey(withAll)).toBe('apikey:secret-key-123');

    // User ID takes precedence over IP
    const withUserAndIp = makeRequest({
      'x-user-id': 'user-uuid',
      'x-forwarded-for': '10.0.0.1',
    });
    expect(extractRateLimitKey(withUserAndIp)).toBe('user:user-uuid');

    // IP from x-forwarded-for (first in list)
    const withIp = makeRequest({ 'x-forwarded-for': '10.0.0.1, 172.16.0.1' });
    expect(extractRateLimitKey(withIp)).toBe('ip:10.0.0.1');

    // Fallback when no headers present
    const empty = makeRequest();
    expect(extractRateLimitKey(empty)).toBe('ip:unknown');
  });
});

describe('RATE_LIMITS configs', () => {
  it('case 6 — checkout config is stricter than public config', () => {
    const { checkout, public: pub } = RATE_LIMITS;

    // Checkout must allow fewer requests per window
    expect(checkout.limit).toBeLessThan(pub.limit);

    // Both should have a positive window
    expect(checkout.windowSeconds).toBeGreaterThan(0);
    expect(pub.windowSeconds).toBeGreaterThan(0);

    // Prefixes must be distinct to avoid key collisions
    expect(checkout.prefix).not.toBe(pub.prefix);
  });
});

// =============================================================================
// Per-tenant sliding window rate limiting tests
// =============================================================================

class MockSlidingWindowRedis implements SlidingWindowRedis {
  // sorted sets: key → Map<member, score>
  private sets = new Map<string, Map<string, number>>();
  private counters = new Map<string, number>();
  private expiries = new Map<string, number>();

  async zadd(key: string, score: number, member: string): Promise<void> {
    if (!this.sets.has(key)) this.sets.set(key, new Map());
    this.sets.get(key)!.set(member, score);
  }

  async zremrangebyscore(key: string, min: number, max: number): Promise<void> {
    const set = this.sets.get(key);
    if (!set) return;
    for (const [member, score] of set.entries()) {
      if (score >= min && score <= max) set.delete(member);
    }
  }

  async zcard(key: string): Promise<number> {
    return this.sets.get(key)?.size ?? 0;
  }

  async incr(key: string): Promise<number> {
    const n = (this.counters.get(key) ?? 0) + 1;
    this.counters.set(key, n);
    return n;
  }

  async expire(key: string, seconds: number): Promise<void> {
    this.expiries.set(key, seconds);
  }

  async ttl(key: string): Promise<number> {
    return this.expiries.get(key) ?? 60;
  }

  /** Test helper: clear all data for a key */
  clear(key: string): void {
    this.sets.delete(key);
  }
}

function makeTenantConfig(overrides?: Partial<TenantRateLimitConfig>): TenantRateLimitConfig {
  return {
    tenantLimit: 5,
    platformLimit: 20,
    windowSeconds: 60,
    prefix: 'test',
    ...overrides,
  };
}

describe('checkTenantRateLimit', () => {
  let redis: MockSlidingWindowRedis;
  const NOW = 1_700_000_000_000; // fixed timestamp for deterministic tests

  beforeEach(() => {
    redis = new MockSlidingWindowRedis();
  });

  it('allows request under tenant limit', async () => {
    const config = makeTenantConfig();
    const result = await checkTenantRateLimit(redis, 'promoter-001', config, NOW);

    expect(result.allowed).toBe(true);
    expect(result.blockedBy).toBeNull();
    expect(result.tenantId).toBe('promoter-001');
    expect(result.remaining).toBe(4); // 5 limit, 1 used
  });

  it('blocks request at tenant limit', async () => {
    const config = makeTenantConfig({ tenantLimit: 3 });

    // Use up the tenant limit
    for (let i = 0; i < 3; i++) {
      await checkTenantRateLimit(redis, 'promoter-002', config, NOW + i);
    }

    const result = await checkTenantRateLimit(redis, 'promoter-002', config, NOW + 3);
    expect(result.allowed).toBe(false);
    expect(result.blockedBy).toBe('tenant');
    expect(result.remaining).toBe(0);
  });

  it('blocks at platform limit before tenant limit', async () => {
    const config = makeTenantConfig({ tenantLimit: 100, platformLimit: 3 });

    // Saturate platform from different tenants
    for (let i = 0; i < 3; i++) {
      await checkTenantRateLimit(redis, `tenant-${i}`, config, NOW + i);
    }

    // A new tenant should be blocked by platform limit
    const result = await checkTenantRateLimit(redis, 'new-tenant', config, NOW + 10);
    expect(result.allowed).toBe(false);
    expect(result.blockedBy).toBe('platform');
    expect(result.platformRemaining).toBe(0);
  });

  it('tenants do not share limits — different promoters independent', async () => {
    const config = makeTenantConfig({ tenantLimit: 2, platformLimit: 100 });

    // Exhaust promoter-A
    await checkTenantRateLimit(redis, 'promoter-A', config, NOW);
    await checkTenantRateLimit(redis, 'promoter-A', config, NOW + 1);
    const blockedA = await checkTenantRateLimit(redis, 'promoter-A', config, NOW + 2);
    expect(blockedA.allowed).toBe(false);

    // promoter-B should still be allowed
    const allowedB = await checkTenantRateLimit(redis, 'promoter-B', config, NOW + 3);
    expect(allowedB.allowed).toBe(true);
  });

  it('sliding window expires old requests', async () => {
    const config = makeTenantConfig({ tenantLimit: 2, windowSeconds: 10 });

    // Two requests at time=0
    await checkTenantRateLimit(redis, 'promoter-X', config, NOW);
    await checkTenantRateLimit(redis, 'promoter-X', config, NOW + 1);

    // Both are counted → at limit
    const blocked = await checkTenantRateLimit(redis, 'promoter-X', config, NOW + 2);
    expect(blocked.allowed).toBe(false);

    // After window expires (11s later), old requests are removed
    const afterWindow = await checkTenantRateLimit(redis, 'promoter-X', config, NOW + 11_000);
    expect(afterWindow.allowed).toBe(true);
  });

  it('returns correct platformRemaining when allowed', async () => {
    const config = makeTenantConfig({ platformLimit: 10 });
    const result = await checkTenantRateLimit(redis, 'promoter-001', config, NOW);

    expect(result.platformRemaining).toBe(9); // 10 - 1 used
  });

  it('returns retryAfterSeconds when blocked', async () => {
    const config = makeTenantConfig({ tenantLimit: 1, windowSeconds: 30 });

    await checkTenantRateLimit(redis, 'promoter-001', config, NOW);
    const blocked = await checkTenantRateLimit(redis, 'promoter-001', config, NOW + 1);

    expect(blocked.retryAfterSeconds).toBe(30);
  });
});

describe('TENANT_RATE_LIMITS configs', () => {
  it('bulk limit is much stricter than api limit', () => {
    expect(TENANT_RATE_LIMITS.bulk.tenantLimit).toBeLessThan(TENANT_RATE_LIMITS.api.tenantLimit);
  });

  it('platform limits are greater than tenant limits', () => {
    expect(TENANT_RATE_LIMITS.checkout.platformLimit).toBeGreaterThan(TENANT_RATE_LIMITS.checkout.tenantLimit);
    expect(TENANT_RATE_LIMITS.api.platformLimit).toBeGreaterThan(TENANT_RATE_LIMITS.api.tenantLimit);
  });

  it('all configs have distinct prefixes', () => {
    const prefixes = Object.values(TENANT_RATE_LIMITS).map(c => c.prefix);
    const unique = new Set(prefixes);
    expect(unique.size).toBe(prefixes.length);
  });
});
