import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  checkRateLimit,
  rateLimitResponse,
  _resetRateLimitStoresForTests,
} from './per-tenant';

beforeEach(() => {
  // Vynuť in-memory fallback (deterministicky) — bez závislosti na Redis.
  process.env.REDIS_URL = 'NONE';
  _resetRateLimitStoresForTests();
});

describe('checkRateLimit (in-memory fallback)', () => {
  it('allows requests under the limit', async () => {
    const cfg = { limit: 3, windowMs: 60_000 };
    expect((await checkRateLimit('p-1', cfg)).ok).toBe(true);
    expect((await checkRateLimit('p-1', cfg)).ok).toBe(true);
    expect((await checkRateLimit('p-1', cfg)).ok).toBe(true);
  });

  it('blocks request that would exceed the limit', async () => {
    const cfg = { limit: 3, windowMs: 60_000 };
    await checkRateLimit('p-1', cfg);
    await checkRateLimit('p-1', cfg);
    await checkRateLimit('p-1', cfg);
    const fourth = await checkRateLimit('p-1', cfg);
    expect(fourth.ok).toBe(false);
    expect(fourth.remaining).toBe(0);
    expect(fourth.retryAfterMs).toBeGreaterThan(0);
  });

  it('decrements remaining count', async () => {
    const cfg = { limit: 5, windowMs: 60_000 };
    expect((await checkRateLimit('p-1', cfg)).remaining).toBe(4);
    expect((await checkRateLimit('p-1', cfg)).remaining).toBe(3);
    expect((await checkRateLimit('p-1', cfg)).remaining).toBe(2);
  });

  it('isolates limits per tenant key', async () => {
    const cfg = { limit: 1, windowMs: 60_000 };
    expect((await checkRateLimit('p-1', cfg)).ok).toBe(true);
    expect((await checkRateLimit('p-2', cfg)).ok).toBe(true);
    // p-1 a p-2 jsou nezávislé
    expect((await checkRateLimit('p-1', cfg)).ok).toBe(false);
    expect((await checkRateLimit('p-2', cfg)).ok).toBe(false);
  });

  it('resets after window expires', async () => {
    vi.useFakeTimers();
    const cfg = { limit: 2, windowMs: 1000 };
    await checkRateLimit('p-1', cfg);
    await checkRateLimit('p-1', cfg);
    expect((await checkRateLimit('p-1', cfg)).ok).toBe(false);
    vi.advanceTimersByTime(1001);
    expect((await checkRateLimit('p-1', cfg)).ok).toBe(true);
    vi.useRealTimers();
  });
});

describe('rateLimitResponse', () => {
  it('returns null when result is ok', () => {
    const r = rateLimitResponse(
      { ok: true, remaining: 5, resetAt: Date.now() + 60_000 },
      'event-create',
    );
    expect(r).toBeNull();
  });

  it('returns 429 with Retry-After header when limited', async () => {
    const r = rateLimitResponse(
      {
        ok: false,
        remaining: 0,
        resetAt: Date.now() + 30_000,
        retryAfterMs: 30_000,
      },
      'event-create',
    );
    expect(r).not.toBeNull();
    expect(r!.status).toBe(429);
    expect(r!.headers.get('Retry-After')).toBe('30');
    const body = await r!.json();
    expect(body.error).toBe('RATE_LIMIT_EXCEEDED');
    expect(body.message).toContain('event-create');
  });
});
