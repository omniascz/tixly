/**
 * Kolo 11 — sdílené volby pro každý pg Pool / Client v aplikaci: nic nesmí čekat na síť bez omezení.
 *
 * Bez `connectionTimeoutMillis` čeká pg na TCP spojení k nedostupnému hostu neomezeně dlouho (na Vercelu při buildu
 * tak visel prerender). Timeouty:
 *   - connectionTimeoutMillis  5 s   — navázání spojení (PG_CONNECT_TIMEOUT_MS),
 *   - statement_timeout       15 s   — server ukončí dotaz (vč. čekání na zámek); ladí se PG_STATEMENT_TIMEOUT_MS,
 *   - query_timeout           +1 s   — klient přestane čekat i tehdy, když server vůbec neodpoví (síť visí).
 */
import type { ClientConfig, PoolConfig } from 'pg';

export const PG_CONNECT_TIMEOUT_MS = 5000;

function statementTimeout(): number {
  return Number(process.env.PG_STATEMENT_TIMEOUT_MS ?? 15000);
}

export function pgClientOptions(connectionString: string | undefined, extra: ClientConfig = {}): ClientConfig {
  const st = statementTimeout();
  return {
    connectionString,
    connectionTimeoutMillis: PG_CONNECT_TIMEOUT_MS,
    statement_timeout: st,
    query_timeout: st + 1000,
    ...extra,
  };
}

export function pgPoolOptions(connectionString: string | undefined, extra: PoolConfig = {}): PoolConfig {
  return { ...pgClientOptions(connectionString), ...extra };
}
