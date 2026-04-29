import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  checkRateLimit,
  rateLimitResponse,
  _resetRateLimitStoresForTests,
} from './per-tenant';

beforeEach(() => {
  _resetRateLimitStoresForTests();
});

describe('checkRateLimit', () => {
  it('allows requests under the limit', () => {
    const cfg = { limit: 3, windowMs: 60_000 };
    expect(checkRateLimit('p-1', cfg).ok).toBe(true);
    expect(checkRateLimit('p-1', cfg).ok).toBe(true);
    expect(checkRateLimit('p-1', cfg).ok).toBe(true);
  });

  it('blocks request that would exceed the limit', () => {
    const cfg = { limit: 3, windowMs: 60_000 };
    checkRateLimit('p-1', cfg);
    checkRateLimit('p-1', cfg);
    checkRateLimit('p-1', cfg);
    const fourth = checkRateLimit('p-1', cfg);
    expect(fourth.ok).toBe(false);
    expect(fourth.remaining).toBe(0);
    expect(fourth.retryAfterMs).toBeGreaterThan(0);
  });

  it('decrements remaining count', () => {
    const cfg = { limit: 5, windowMs: 60_000 };
    expect(checkRateLimit('p-1', cfg).remaining).toBe(4);
    expect(checkRateLimit('p-1', cfg).remaining).toBe(3);
    expect(checkRateLimit('p-1', cfg).remaining).toBe(2);
  });

  it('isolates limits per tenant key', () => {
    const cfg = { limit: 1, windowMs: 60_000 };
    expect(checkRateLimit('p-1', cfg).ok).toBe(true);
    expect(checkRateLimit('p-2', cfg).ok).toBe(true);
    // p-1 a p-2 jsou nezávislé
    expect(checkRateLimit('p-1', cfg).ok).toBe(false);
    expect(checkRateLimit('p-2', cfg).ok).toBe(false);
  });

  it('resets after window expires', () => {
    vi.useFakeTimers();
    const cfg = { limit: 2, windowMs: 1000 };
    checkRateLimit('p-1', cfg);
    checkRateLimit('p-1', cfg);
    expect(checkRateLimit('p-1', cfg).ok).toBe(false);
    vi.advanceTimersByTime(1001);
    expect(checkRateLimit('p-1', cfg).ok).toBe(true);
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
