/**
 * checkout-deps.ts — sdílený DB adaptér pro checkout orchestrátor.
 *
 * Singleton Pool přežije restartování Next.js route handlerů (hot-reload).
 * Stejný vzor jako gopay-payments/src/lib/service-container.ts.
 *
 * Všechny částky jsou INTEGER haléře. Nikdy float.
 */

import { Pool, type PoolClient } from 'pg';

// ---------------------------------------------------------------------------
// DbAdapter interface (opakování definice, aby se nemuselo cross-importovat)
// ---------------------------------------------------------------------------

export interface DbAdapter {
  query<T = Record<string, unknown>>(sql: string, params?: unknown[]): Promise<T[]>;
  execute(sql: string, params?: unknown[]): Promise<void>;
  transaction<T>(fn: (tx: DbAdapter) => Promise<T>): Promise<T>;
}

// ---------------------------------------------------------------------------
// Singleton pool
// ---------------------------------------------------------------------------

declare global {
  // eslint-disable-next-line no-var
  var _checkoutPool: Pool | undefined;
}

function getPool(): Pool {
  if (!global._checkoutPool) {
    global._checkoutPool = new Pool({ connectionString: process.env.DATABASE_URL });
  }
  return global._checkoutPool;
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
    const pool = getPool();
    const client: PoolClient = await pool.connect();
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
  return new PgDbAdapter(getPool());
}
