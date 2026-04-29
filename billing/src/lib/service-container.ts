import { Pool, PoolClient } from 'pg';
import type { BillingDB } from '../services/invoice.service.js';

declare global {
  var _billingDeps: { db: BillingDB } | undefined;
}

class PgBillingDB implements BillingDB {
  private client: { query: (sql: string, params?: unknown[]) => Promise<{ rows: unknown[] }> } | null = null;

  constructor(private pool: Pool) {}

  async query<T>(sql: string, params?: unknown[]): Promise<T[]> {
    const src = this.client ?? this.pool;
    const result = await src.query(sql as string, params as unknown[]);
    return result.rows as T[];
  }

  async execute(sql: string, params?: unknown[]): Promise<void> {
    const src = this.client ?? this.pool;
    await src.query(sql as string, params as unknown[]);
  }

  async transaction<T>(fn: (tx: BillingDB) => Promise<T>): Promise<T> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const txDb = new PgBillingDB(this.pool);
      (txDb as any).client = client;
      const result = await fn(txDb);
      await client.query('COMMIT');
      return result;
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      (client as PoolClient).release();
    }
  }
}

export function getServiceDeps(): { db: BillingDB } {
  if (!process.env.DATABASE_URL) {
    throw new Error('DATABASE_URL is not set');
  }
  if (!global._billingDeps) {
    const pool = new Pool({ connectionString: process.env.DATABASE_URL });
    global._billingDeps = { db: new PgBillingDB(pool) };
  }
  return global._billingDeps;
}
