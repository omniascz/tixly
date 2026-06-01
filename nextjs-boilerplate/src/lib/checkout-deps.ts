/**
 * checkout-deps.ts — sdílený DB adaptér pro checkout orchestrátor.
 *
 * RLS Fáze 2: používá sdílené context-aware db() z rls-pool. Checkout routes
 * běží v runWithServiceContext, takže query/connect přes tento adaptér zdědí
 * service kontext (SET LOCAL app.role) z AsyncLocalStorage.
 *
 * Všechny částky jsou INTEGER haléře. Nikdy float.
 */

import type { PoolClient } from 'pg';
import { db as rlsDb } from '@/lib/db/rls-pool';

// ---------------------------------------------------------------------------
// DbAdapter interface (opakování definice, aby se nemuselo cross-importovat)
// ---------------------------------------------------------------------------

export interface DbAdapter {
  query<T = Record<string, unknown>>(sql: string, params?: unknown[]): Promise<T[]>;
  execute(sql: string, params?: unknown[]): Promise<void>;
  transaction<T>(fn: (tx: DbAdapter) => Promise<T>): Promise<T>;
}

// ---------------------------------------------------------------------------
// PgDbAdapter
// ---------------------------------------------------------------------------

class PgDbAdapter implements DbAdapter {
  constructor(private readonly runner: {
    query(sql: string, params?: unknown[]): Promise<{ rows: unknown[] }>;
  }) {}

  async query<T>(sql: string, params?: unknown[]): Promise<T[]> {
    const res = await this.runner.query(sql, params);
    return res.rows as T[];
  }

  async execute(sql: string, params?: unknown[]): Promise<void> {
    await this.runner.query(sql, params);
  }

  async transaction<T>(fn: (tx: DbAdapter) => Promise<T>): Promise<T> {
    // rlsDb().connect() injektuje RLS kontext z ALS (SET LOCAL) na clienta.
    const client: PoolClient = await rlsDb().connect();
    try {
      await client.query('BEGIN');
      const txAdapter = new PgDbAdapter(client);
      const result = await fn(txAdapter);
      await client.query('COMMIT');
      return result;
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  }
}

// ---------------------------------------------------------------------------
// Public factory
// ---------------------------------------------------------------------------

export function getCheckoutDb(): DbAdapter {
  return new PgDbAdapter(rlsDb());
}
