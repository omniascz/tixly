/**
 * Kolo 11 — sdílené volby pro každého klienta Redisu (node-redis 4): nic nesmí čekat na síť bez omezení.
 *
 * Výchozí node-redis 4 se po neúspěšném spojení pokouší připojit DONEKONEČNA (reconnectStrategy), takže `connect()`
 * na nedostupný host nikdy neskončí chybou — na Vercelu tím visel prerender /api/health/redis. Proto:
 *   - socket.connectTimeout 5 s (REDIS_CONNECT_TIMEOUT_MS),
 *   - reconnectStrategy: nejvýš REDIS_MAX_RETRIES pokusů, pak chyba (connect() se odmítne),
 *   - disableOfflineQueue: příkaz bez spojení selže hned, nečeká ve frontě,
 *   - timeout příkazu 5 s (REDIS_COMMAND_TIMEOUT_MS) — node-redis 4 ho nemá vestavěný, proto `withRedisTimeout`.
 */
import type { RedisClientOptions } from 'redis';
import { withTimeout } from '@/lib/net/with-timeout';

export const REDIS_CONNECT_TIMEOUT_MS = 5000;
export const REDIS_COMMAND_TIMEOUT_MS = 5000;
export const REDIS_MAX_RETRIES = 2;

export function redisClientOptions(url: string | undefined): RedisClientOptions {
  return {
    url,
    disableOfflineQueue: true,
    socket: {
      connectTimeout: REDIS_CONNECT_TIMEOUT_MS,
      reconnectStrategy: (retries: number, cause: Error) =>
        retries >= REDIS_MAX_RETRIES ? new Error(`Redis nedostupný po ${retries} pokusech: ${cause?.message ?? ''}`) : Math.min(200 * (retries + 1), 1000),
    },
  };
}

/** Příkaz (nebo connect) Redisu s limitem REDIS_COMMAND_TIMEOUT_MS. */
export function withRedisTimeout<T>(p: Promise<T>, ms: number = REDIS_COMMAND_TIMEOUT_MS, what = 'Redis příkaz'): Promise<T> {
  return withTimeout(p, ms, what);
}

/**
 * Klient, jehož každý příkaz (metoda vracející Promise) má limit REDIS_COMMAND_TIMEOUT_MS.
 * Pro spojení, které je otevřené, ale server neodpovídá (disableOfflineQueue pokryje jen rozpojený stav).
 */
export function withCommandTimeouts<T extends object>(client: T, ms: number = REDIS_COMMAND_TIMEOUT_MS): T {
  return new Proxy(client, {
    get(target, prop, receiver) {
      const v: unknown = Reflect.get(target, prop, receiver);
      if (typeof v !== 'function') return v;
      return (...args: unknown[]) => {
        const r: unknown = (v as (...a: unknown[]) => unknown).apply(target, args);
        return r instanceof Promise ? withTimeout(r, ms, `Redis ${String(prop)}`) : r;
      };
    },
  });
}
