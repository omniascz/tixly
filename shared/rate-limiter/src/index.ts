// =============================================================================
// @tixly/rate-limiter — Redis-based rate limiting
// =============================================================================

export interface RateLimitConfig {
  /** Max requests in window */
  limit: number;
  /** Window in seconds */
  windowSeconds: number;
  /** Key prefix for Redis */
  prefix?: string;
}

export interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  resetAt: Date;
  retryAfterSeconds: number | null;
}

export interface RedisLike {
  incr(key: string): Promise<number>;
  expire(key: string, seconds: number): Promise<void>;
  ttl(key: string): Promise<number>;
}

/**
 * Check rate limit for a key (e.g., IP address, user ID, API key).
 * Uses Redis INCR + EXPIRE (sliding window counter).
 *
 * @param redis  - Redis-compatible adapter
 * @param key    - Unique identifier (IP, user ID, API key)
 * @param config - Rate limit configuration
 */
export async function checkRateLimit(
  redis: RedisLike,
  key: string,
  config: RateLimitConfig,
): Promise<RateLimitResult> {
  const redisKey = `${config.prefix ?? 'rl'}:${key}`;
  const count = await redis.incr(redisKey);
  if (count === 1) {
    await redis.expire(redisKey, config.windowSeconds);
  }
  const ttl = await redis.ttl(redisKey);
  const resetAt = new Date(Date.now() + ttl * 1000);

  if (count > config.limit) {
    return { allowed: false, remaining: 0, resetAt, retryAfterSeconds: ttl };
  }
  return { allowed: true, remaining: config.limit - count, resetAt, retryAfterSeconds: null };
}

/**
 * Extract rate limit key from a Next.js (or standard Fetch API) request.
 * Priority: API key header → user ID header → IP address → fallback
 */
export function extractRateLimitKey(request: Request): string {
  const apiKey = request.headers.get('x-api-key');
  if (apiKey) return `apikey:${apiKey}`;

  const userId = request.headers.get('x-user-id');
  if (userId) return `user:${userId}`;

  const forwarded = request.headers.get('x-forwarded-for');
  const ip = forwarded?.split(',')[0]?.trim();
  if (ip) return `ip:${ip}`;

  return 'ip:unknown';
}

/** Standard configs for common endpoint categories */
export const RATE_LIMITS = {
  /** Public endpoints: 60 req/min per IP */
  public: { limit: 60, windowSeconds: 60, prefix: 'rl:pub' } as RateLimitConfig,
  /** Authenticated endpoints: 120 req/min per user */
  authenticated: { limit: 120, windowSeconds: 60, prefix: 'rl:auth' } as RateLimitConfig,
  /** Checkout: 10 req/min per IP (anti-bot) */
  checkout: { limit: 10, windowSeconds: 60, prefix: 'rl:checkout' } as RateLimitConfig,
  /** Admin: 300 req/min per user */
  admin: { limit: 300, windowSeconds: 60, prefix: 'rl:admin' } as RateLimitConfig,
  /** Webhooks: 100 req/min per IP */
  webhook: { limit: 100, windowSeconds: 60, prefix: 'rl:wh' } as RateLimitConfig,
};

// =============================================================================
// Per-tenant sliding window rate limiting (Task #214)
// =============================================================================
//
// Jeden promotér nesmí vyčerpat kapacitu ostatním.
// Implementace: Redis sorted set — každý request přidá timestamp jako member.
// Okno se posouvá reálně (true sliding window), ne counter reset.
//
// Redis sorted set commands needed:
//   ZADD key score member    — přidá request s timestamp jako score
//   ZREMRANGEBYSCORE key 0 min  — odstraní staré requesty
//   ZCARD key               — počet requestů v okně
//   EXPIRE key seconds      — nastaví TTL pro auto-cleanup
//
// Platform-wide hard limit: platform limit zkontrolován PŘED tenant limitem,
// aby nedošlo k denial-of-service jednoho tenanta vůči ostatním.

export interface TenantRateLimitConfig {
  /** Max requests per tenant in the sliding window */
  tenantLimit: number;
  /** Platform-wide max requests across ALL tenants combined */
  platformLimit: number;
  /** Sliding window in seconds */
  windowSeconds: number;
  /** Key prefix for Redis sorted sets */
  prefix?: string;
}

export interface TenantRateLimitResult extends RateLimitResult {
  tenantId: string;
  platformRemaining: number;
  blockedBy: 'tenant' | 'platform' | null;
}

/**
 * Redis adapter extended with sorted set operations needed for sliding window.
 */
export interface SlidingWindowRedis extends RedisLike {
  zadd(key: string, score: number, member: string): Promise<void>;
  zremrangebyscore(key: string, min: number, max: number): Promise<void>;
  zcard(key: string): Promise<number>;
}

/**
 * Per-tenant sliding window rate limiting.
 *
 * Checks TWO limits in order:
 * 1. Platform-wide limit (shared across all tenants) — prevents monopolization
 * 2. Per-tenant limit — prevents one promoter from hogging bandwidth
 *
 * Both use Redis sorted sets for accurate sliding windows.
 *
 * @param redis      - Redis client with sorted set support
 * @param tenantId   - promoter_id (tenant identifier)
 * @param config     - rate limit config
 * @param nowMs      - optional override for current time (for testing)
 */
export async function checkTenantRateLimit(
  redis: SlidingWindowRedis,
  tenantId: string,
  config: TenantRateLimitConfig,
  nowMs: number = Date.now(),
): Promise<TenantRateLimitResult> {
  const prefix = config.prefix ?? 'trl';
  const windowMs = config.windowSeconds * 1000;
  const windowStart = nowMs - windowMs;
  const member = `${nowMs}-${Math.random().toString(36).slice(2)}`; // unique member per request

  const tenantKey = `${prefix}:tenant:${tenantId}`;
  const platformKey = `${prefix}:platform`;
  const resetAt = new Date(nowMs + config.windowSeconds * 1000);

  // --- Platform check ---
  await redis.zremrangebyscore(platformKey, 0, windowStart);
  const platformCount = await redis.zcard(platformKey);

  if (platformCount >= config.platformLimit) {
    return {
      allowed: false,
      remaining: 0,
      resetAt,
      retryAfterSeconds: config.windowSeconds,
      tenantId,
      platformRemaining: 0,
      blockedBy: 'platform',
    };
  }

  // --- Tenant check ---
  await redis.zremrangebyscore(tenantKey, 0, windowStart);
  const tenantCount = await redis.zcard(tenantKey);

  if (tenantCount >= config.tenantLimit) {
    return {
      allowed: false,
      remaining: 0,
      resetAt,
      retryAfterSeconds: config.windowSeconds,
      tenantId,
      platformRemaining: config.platformLimit - platformCount,
      blockedBy: 'tenant',
    };
  }

  // --- Record the request in both sets ---
  await redis.zadd(tenantKey, nowMs, member);
  await redis.expire(tenantKey, config.windowSeconds + 1); // +1 for safety margin
  await redis.zadd(platformKey, nowMs, member);
  await redis.expire(platformKey, config.windowSeconds + 1);

  return {
    allowed: true,
    remaining: config.tenantLimit - tenantCount - 1,
    resetAt,
    retryAfterSeconds: null,
    tenantId,
    platformRemaining: config.platformLimit - platformCount - 1,
    blockedBy: null,
  };
}

/** Default per-tenant rate limit configs */
export const TENANT_RATE_LIMITS = {
  /** Ticket checkout: 500 req/min per tenant, 5000 platform-wide */
  checkout: {
    tenantLimit: 500,
    platformLimit: 5000,
    windowSeconds: 60,
    prefix: 'trl:checkout',
  } as TenantRateLimitConfig,

  /** API general: 2000 req/min per tenant, 20000 platform-wide */
  api: {
    tenantLimit: 2000,
    platformLimit: 20000,
    windowSeconds: 60,
    prefix: 'trl:api',
  } as TenantRateLimitConfig,

  /** Bulk operations (import, mass email): 10 req/min per tenant */
  bulk: {
    tenantLimit: 10,
    platformLimit: 100,
    windowSeconds: 60,
    prefix: 'trl:bulk',
  } as TenantRateLimitConfig,
};
