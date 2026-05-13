import { Pool, PoolClient } from 'pg';

export type { DbAdapter } from '@tixly/db-adapter';
import type { DbAdapter } from '@tixly/db-adapter';

export interface ServiceDeps {
  db: DbAdapter;
}

declare global {
  // eslint-disable-next-line no-var
  var _buyerPortalDeps: ServiceDeps | undefined;
}

class PgDbAdapter implements DbAdapter {
  constructor(private pool: Pool) {}

  async query<T>(sql: string, params?: unknown[]): Promise<T[]> {
    const result = await this.pool.query(sql, params);
    return result.rows as T[];
  }

  async execute(sql: string, params?: unknown[]): Promise<void> {
    await this.pool.query(sql, params);
  }

  async transaction<T>(fn: (tx: DbAdapter) => Promise<T>): Promise<T> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const txAdapter = new PgDbAdapter(this.pool);
      txAdapter.setClient(client);
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

  setClient(client: PoolClient): void {
    (this as any).pool = {
      query: (sql: string, params?: unknown[]) => client.query(sql, params),
    };
  }
}

export function getServiceDeps(): ServiceDeps {
  if (!process.env.DATABASE_URL) {
    throw new Error('DATABASE_URL environment variable is not set');
  }

  if (!global._buyerPortalDeps) {
    const pool = new Pool({
      connectionString: process.env.DATABASE_URL,
    });

    const db = new PgDbAdapter(pool);
    global._buyerPortalDeps = { db };
  }

  return global._buyerPortalDeps;
}
