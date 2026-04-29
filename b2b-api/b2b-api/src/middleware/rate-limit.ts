import { NextResponse } from "next/server";
import type { ApiKeyContext } from "./api-key-auth";
import { errorResponse } from "./api-key-auth";

// ---------------------------------------------------------------------------
// Tier limity (req/min)
// ---------------------------------------------------------------------------
const TIER_LIMITS: Record<string, number> = {
  free: 100,
  standard: 1_000,
  premium: 10_000,
};

const WINDOW_SEC = 60;

// ---------------------------------------------------------------------------
// Redis adapter interface
// ---------------------------------------------------------------------------
export interface RateLimitRedis {
  /** Přidá member do sorted setu a vrátí aktuální počet členů v okně. */
  pipeline(): {
    zremrangebyscore(key: string, min: string | number, max: number): void;
    zadd(key: string, score: number, member: string): void;
    zcard(key: string): void;
    expire(key: string, ttl: number): void;
    exec(): Promise<Array<[Error | null, unknown]>>;
  };
}

// Stub — nahradit reálnou Redis instancí
export const rateLimitRedis = {} as RateLimitRedis;

// ---------------------------------------------------------------------------
// Sliding window rate limiter
// ---------------------------------------------------------------------------

export interface RateLimitResult {
  allowed: boolean;
  limit: number;
  remaining: number;
  resetAt: number; // unix timestamp
}

/**
 * Zkontroluje rate limit pro daný API klíč pomocí Redis sorted set.
 * Algoritmus: sliding window — odstraní záznamy starší než 60s, přidá nový, spočítá.
 */
export async function checkRateLimit(
  ctx: ApiKeyContext
): Promise<RateLimitResult> {
  const limit = TIER_LIMITS[ctx.tier] ?? TIER_LIMITS.free;
  const now = Date.now();
  const windowStart = now - WINDOW_SEC * 1_000;
  const redisKey = `ratelimit:v1:${ctx.keyId}`;
  const resetAt = Math.ceil((now + WINDOW_SEC * 1_000) / 1_000);

  const pipe = rateLimitRedis.pipeline();
  pipe.zremrangebyscore(redisKey, "-inf", windowStart);
  pipe.zadd(redisKey, now, `${now}-${Math.random().toString(36).slice(2)}`);
  pipe.zcard(redisKey);
  pipe.expire(redisKey, WINDOW_SEC + 1);
  const results = await pipe.exec();

  const count = (results[2][1] as number) ?? 0;
  const allowed = count <= limit;
  const remaining = Math.max(0, limit - count);

  return { allowed, limit, remaining, resetAt };
}

// ---------------------------------------------------------------------------
// Middleware wrapper — přidá rate limit headers a vrátí 429 pokud exceeded
// ---------------------------------------------------------------------------

/**
 * Pokud rate limit překročen, vrátí 429 NextResponse s Retry-After.
 * Jinak vrátí null a caller pokračuje.
 * Headers se nastavují na response — caller musí je přidat na svůj response.
 */
export async function applyRateLimit(
  ctx: ApiKeyContext
): Promise<{ blocked: NextResponse } | { headers: Record<string, string> }> {
  const result = await checkRateLimit(ctx);

  const headers: Record<string, string> = {
    "X-RateLimit-Limit": String(result.limit),
    "X-RateLimit-Remaining": String(result.remaining),
    "X-RateLimit-Reset": String(result.resetAt),
  };

  if (!result.allowed) {
    const retryAfter = result.resetAt - Math.floor(Date.now() / 1_000);
    const response = errorResponse(
      429,
      "RATE_LIMIT_EXCEEDED",
      `Rate limit exceeded. Tier '${ctx.tier}' allows ${result.limit} requests/min.`,
      ctx.requestId
    );

    // Přidat headers na chybovou response
    Object.entries({ ...headers, "Retry-After": String(retryAfter) }).forEach(
      ([k, v]) => response.headers.set(k, v)
    );

    return { blocked: response };
  }

  return { headers };
}

/**
 * Helper: přidá rate limit headers na existující NextResponse.
 */
export function withRateLimitHeaders(
  response: NextResponse,
  headers: Record<string, string>
): NextResponse {
  Object.entries(headers).forEach(([k, v]) => response.headers.set(k, v));
  return response;
}
