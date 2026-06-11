/**
 * Per-tenant rate limiter (sliding window).
 *
 * Multi-tenant safety: jeden promotér nesmí vyčerpat kapacitu ostatním.
 * V demu používáme in-memory store; v produkci stačí podobné API přepojit
 * na Redis (INCR + EXPIRE per (key, bucket)).
 *
 * Algoritmus: sliding window log — v paměti držíme posledních N ms timestampů
 * pro každý klíč, na začátku requestu vyhodíme starší než window a porovnáme
 * count s limitem.
 *
 * Klíč: typicky `${promoterId}:${endpoint}` (např. `abc:event-create`).
 *
 * Hard limit → 429 RateLimited
 * Soft warning → header `X-RateLimit-Remaining` ve výsledku
 */

export interface RateLimitConfig {
  /** Maximum requestů v okně. */
  limit: number;
  /** Délka sliding window v ms (např. 60000 = 1 min). */
  windowMs: number;
}

export interface RateLimitResult {
  ok: boolean;
  remaining: number;
  resetAt: number;
  /** Pokud `!ok`, kolik ms počkat než další pokus (Retry-After). */
  retryAfterMs?: number;
}

const stores = new Map<string, number[]>();

/**
 * Vyhodnotí rate limit pro daný klíč.
 *
 * Primárně přes Redis (fixed-window INCR+EXPIRE) → GLOBÁLNÍ limit napříč všemi
 * serverless instancemi. Když Redis není k dispozici (REDIS_URL=NONE / výpadek),
 * spadne na in-memory sliding-window (per-instance) — degradace, ne výpadek ochrany.
 */
export async function checkRateLimit(
  key: string,
  config: RateLimitConfig,
): Promise<RateLimitResult> {
  // Lazy import, ať se Redis klient neváže do edge/bundle, kde není potřeba.
  let redis: Awaited<ReturnType<typeof import('@/lib/queue/redis-queue').getClient>> = null;
  try {
    const { getClient } = await import('@/lib/queue/redis-queue');
    redis = await getClient();
  } catch {
    redis = null;
  }

  if (redis) {
    try {
      const bucket = Math.floor(Date.now() / config.windowMs);
      const rkey = `rl:${key}:${bucket}`;
      const count = await redis.incr(rkey);
      if (count === 1) await redis.pExpire(rkey, config.windowMs);
      const resetAt = (bucket + 1) * config.windowMs;
      if (count > config.limit) {
        return { ok: false, remaining: 0, resetAt, retryAfterMs: resetAt - Date.now() };
      }
      return { ok: true, remaining: config.limit - count, resetAt };
    } catch {
      // Redis chyba uprostřed → fallback na in-memory
    }
  }
  return checkRateLimitInMemory(key, config);
}

/** In-memory sliding-window log (fallback / dev bez Redis). */
function checkRateLimitInMemory(key: string, config: RateLimitConfig): RateLimitResult {
  const now = Date.now();
  const windowStart = now - config.windowMs;
  const existing = stores.get(key) ?? [];
  const fresh = existing.filter((t) => t > windowStart);
  if (fresh.length >= config.limit) {
    const oldest = fresh[0];
    return { ok: false, remaining: 0, resetAt: oldest + config.windowMs, retryAfterMs: oldest + config.windowMs - now };
  }
  fresh.push(now);
  stores.set(key, fresh);
  return { ok: true, remaining: config.limit - fresh.length, resetAt: now + config.windowMs };
}

/** Pro testy — vyčistí stav. */
export function _resetRateLimitStoresForTests(): void {
  stores.clear();
}

/**
 * Aplikuje rate limit a v případě překročení vrátí standardizovanou
 * 429 odpověď. Jinak null.
 */
export function rateLimitResponse(
  result: RateLimitResult,
  endpoint: string,
): Response | null {
  if (result.ok) return null;
  const headers = new Headers({ 'Content-Type': 'application/json' });
  if (result.retryAfterMs) {
    headers.set('Retry-After', String(Math.ceil(result.retryAfterMs / 1000)));
  }
  headers.set('X-RateLimit-Reset', String(Math.floor(result.resetAt / 1000)));
  return new Response(
    JSON.stringify({
      error: 'RATE_LIMIT_EXCEEDED',
      message: `Příliš mnoho požadavků na ${endpoint}. Zkuste to prosím za chvíli.`,
      retryAfterMs: result.retryAfterMs ?? null,
    }),
    { status: 429, headers },
  );
}
