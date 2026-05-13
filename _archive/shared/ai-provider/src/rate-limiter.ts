/**
 * Redis-based daily rate limiter for AI calls.
 *
 * Projects configure plan limits and provide a Redis-like cache adapter.
 * Counter key format: ai:ratelimit:{tenantId}:{feature}:{YYYY-MM-DD}
 */
import type { AiCacheAdapter, AiRateLimiter } from './types.js';

export interface RateLimitConfig {
  /** Map of plan name → daily limit. */
  planLimits: Record<string, number>;
  /** Default limit when plan is unknown. */
  defaultLimit: number;
  /** Async function to look up a tenant's plan name. */
  getPlan: (tenantId: string) => Promise<string>;
  /** Redis-like cache adapter for counters. */
  cache: AiCacheAdapter;
  /**
   * Error factory — called when limit is exceeded.
   * Return an Error (or subclass) that will be thrown.
   */
  createError: (info: {
    feature: string;
    plan: string;
    limit: number;
    used: number;
  }) => Error;
}

/**
 * Create a rate limiter function compatible with AiProviderConfig.rateLimiter.
 */
export function createRateLimiter(config: RateLimitConfig): AiRateLimiter {
  return async (tenantId: string, feature: string): Promise<void> => {
    const plan = await config.getPlan(tenantId);
    const limit = config.planLimits[plan] ?? config.defaultLimit;

    const today = new Date().toISOString().slice(0, 10);
    const key = `ai:ratelimit:${tenantId}:${feature}:${today}`;

    const current = await config.cache.incr(key);
    if (current === 1) {
      // Set TTL to end of day + 1h buffer
      const secondsUntilMidnight = 86400 - (Math.floor(Date.now() / 1000) % 86400);
      await config.cache.expire(key, secondsUntilMidnight + 3600);
    }

    if (current > limit) {
      await config.cache.decr(key);
      throw config.createError({
        feature,
        plan,
        limit,
        used: current - 1,
      });
    }
  };
}
