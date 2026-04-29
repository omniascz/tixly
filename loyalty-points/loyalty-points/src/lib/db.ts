// db.ts — PostgreSQL adapter singleton pro loyalty-points modul.
// Lazy inicializace poolu — pool se nevytváří při importu v testovém prostředí.

import type { ServiceDeps } from '../services/loyalty.service';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let _pool: any | null = null;

function getPool() {
  if (!_pool) {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { Pool } = require('pg') as typeof import('pg');
    _pool = new Pool({ connectionString: process.env['DATABASE_URL'] });
  }
  return _pool;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type DbAdapter = ServiceDeps['db'];

function buildAdapter(): DbAdapter {
  const pool = getPool();

  return {
    async query<T>(sql: string, params?: unknown[]): Promise<T[]> {
      const result = await pool.query(sql, params);
      return result.rows as T[];
    },

    async execute(sql: string, params?: unknown[]): Promise<void> {
      await pool.query(sql, params);
    },

    async transaction<T>(fn: (tx: DbAdapter) => Promise<T>): Promise<T> {
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        const txAdapter: DbAdapter = {
          async query<U>(sql: string, params?: unknown[]): Promise<U[]> {
            const result = await client.query(sql, params);
            return result.rows as U[];
          },
          async execute(sql: string, params?: unknown[]): Promise<void> {
            await client.query(sql, params);
          },
          transaction<U>(innerFn: (tx: DbAdapter) => Promise<U>): Promise<U> {
            // Nested transactions — reuse same client (savepoint by convention)
            return innerFn(txAdapter);
          },
        };
        const result = await fn(txAdapter);
        await client.query('COMMIT');
        return result;
      } catch (err) {
        await client.query('ROLLBACK');
        throw err;
      } finally {
        client.release();
      }
    },
  };
}

let _adapter: DbAdapter | null = null;

export function getDb(): DbAdapter {
  if (!_adapter) {
    _adapter = buildAdapter();
  }
  return _adapter;
}
