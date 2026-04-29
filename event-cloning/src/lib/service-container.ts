import { Pool, PoolClient } from 'pg';
import type { DbAdapter } from '@tixly/db-adapter';

export interface ServiceDeps {
  db: DbAdapter;
}

declare global {
  // eslint-disable-next-line no-var
  var _eventCloningDeps: ServiceDeps | undefined;
}

class PgDbAdapter implements DbAdapter {
  constructor(private pool: Pool) {}

  async query<T = Record<string, unknown>>(sql: string, params?: unknown[]): Promise<T[]> {
    const result = await this.pool.query(sql, params);
    return result.rows as T[];
  }

  async queryOne<T = Record<string, unknown>>(sql: string, params?: unknown[]): Promise<T | null> {
    const result = await this.pool.query(sql, params);
    return (result.rows[0] as T) ?? null;
  }

  async execute(sql: string, params?: unknown[]): Promise<void> {
    await this.pool.query(sql, params);
  }

  async transaction<T>(fn: (tx: DbAdapter) => Promise<T>): Promise<T> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const txAdapter = new PgDbAdapterTx(client);
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

class PgDbAdapterTx implements DbAdapter {
  constructor(private client: PoolClient) {}

  async query<T = Record<string, unknown>>(sql: string, params?: unknown[]): Promise<T[]> {
    const result = await this.client.query(sql, params);
    return result.rows as T[];
  }

  async queryOne<T = Record<string, unknown>>(sql: string, params?: unknown[]): Promise<T | null> {
    const result = await this.client.query(sql, params);
    return (result.rows[0] as T) ?? null;
  }

  async execute(sql: string, params?: unknown[]): Promise<void> {
    await this.client.query(sql, params);
  }

  async transaction<T>(fn: (tx: DbAdapter) => Promise<T>): Promise<T> {
    return fn(this);
  }
}

export function getServiceDeps(): ServiceDeps {
  if (!global._eventCloningDeps) {
    if (!process.env.DATABASE_URL) {
      throw new Error('DATABASE_URL environment variable is not set');
    }
    const pool = new Pool({ connectionString: process.env.DATABASE_URL });
    global._eventCloningDeps = { db: new PgDbAdapter(pool) };
  }
  return global._eventCloningDeps;
}
