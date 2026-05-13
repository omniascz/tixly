import { describe, it, expect, vi } from 'vitest';
import { createRateLimiter } from './rate-limiter.js';
import type { AiCacheAdapter } from './types.js';

function mockCache(currentCount = 1): AiCacheAdapter {
  return {
    get: vi.fn().mockResolvedValue(null),
    setex: vi.fn().mockResolvedValue('OK'),
    incr: vi.fn().mockResolvedValue(currentCount),
    decr: vi.fn().mockResolvedValue(currentCount - 1),
    expire: vi.fn().mockResolvedValue(1),
    del: vi.fn().mockResolvedValue(1),
  };
}

describe('createRateLimiter', () => {
  it('allows calls under the limit', async () => {
    const cache = mockCache(5); // 5th call
    const limiter = createRateLimiter({
      planLimits: { pro: 100 },
      defaultLimit: 10,
      getPlan: vi.fn().mockResolvedValue('pro'),
      cache,
      createError: ({ feature, plan, limit, used }) =>
        new Error(`Rate limit: ${used}/${limit} for ${feature} on ${plan}`),
    });

    await expect(limiter('org-1', 'translate')).resolves.toBeUndefined();
    expect(cache.incr).toHaveBeenCalledWith(expect.stringContaining('ai:ratelimit:org-1:translate:'));
  });

  it('throws when limit is exceeded', async () => {
    const cache = mockCache(11); // 11th call, over limit of 10
    const limiter = createRateLimiter({
      planLimits: { free: 10 },
      defaultLimit: 10,
      getPlan: vi.fn().mockResolvedValue('free'),
      cache,
      createError: ({ limit, used }) => new Error(`Exceeded: ${used}/${limit}`),
    });

    await expect(limiter('org-1', 'translate')).rejects.toThrow('Exceeded: 10/10');
    // Should decrement after exceeding
    expect(cache.decr).toHaveBeenCalled();
  });

  it('sets TTL on first call of the day', async () => {
    const cache = mockCache(1); // first call
    const limiter = createRateLimiter({
      planLimits: { pro: 100 },
      defaultLimit: 10,
      getPlan: vi.fn().mockResolvedValue('pro'),
      cache,
      createError: () => new Error('limit'),
    });

    await limiter('org-1', 'generate_email');

    expect(cache.expire).toHaveBeenCalledWith(
      expect.stringContaining('ai:ratelimit:'),
      expect.any(Number),
    );
  });

  it('does not set TTL on subsequent calls', async () => {
    const cache = mockCache(5); // 5th call
    const limiter = createRateLimiter({
      planLimits: { pro: 100 },
      defaultLimit: 10,
      getPlan: vi.fn().mockResolvedValue('pro'),
      cache,
      createError: () => new Error('limit'),
    });

    await limiter('org-1', 'generate_email');

    expect(cache.expire).not.toHaveBeenCalled();
  });

  it('uses default limit for unknown plan', async () => {
    const cache = mockCache(6); // 6th call, default limit is 5
    const limiter = createRateLimiter({
      planLimits: { pro: 100 },
      defaultLimit: 5,
      getPlan: vi.fn().mockResolvedValue('unknown-plan'),
      cache,
      createError: ({ limit }) => new Error(`Limit: ${limit}`),
    });

    await expect(limiter('org-1', 'translate')).rejects.toThrow('Limit: 5');
  });

  it('includes feature in rate limit key', async () => {
    const cache = mockCache(1);
    const limiter = createRateLimiter({
      planLimits: { free: 10 },
      defaultLimit: 10,
      getPlan: vi.fn().mockResolvedValue('free'),
      cache,
      createError: () => new Error('limit'),
    });

    await limiter('org-1', 'subject_lines');

    expect(cache.incr).toHaveBeenCalledWith(
      expect.stringContaining('subject_lines'),
    );
  });
});
