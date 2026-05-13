import { Pool, PoolClient } from 'pg';

export type { DbAdapter } from '@tixly/db-adapter';
import type { DbAdapter as BaseDbAdapter } from '@tixly/db-adapter';
import type { DbAdapter, KafkaProducerAdapter } from '../types/referral.types.js';

// ============================================================
// Referral System — Service Container
// ============================================================
//
// Canonical dependency injection entry-point for the referral-system
// module. Route handlers and cron jobs import `getServiceDeps()` instead
// of relying on ambient `declare const getDb` stubs that fail at runtime.
//
// Pattern mirrors venue-ownership/src/lib/service-container.ts.

export interface ServiceDeps {
  db: DbAdapter;
  kafka: KafkaProducerAdapter;
  baseUrl: string;
}

declare global {
  // eslint-disable-next-line no-var
  var _referralSystemDeps: ServiceDeps | undefined;
}

class PgDbAdapter implements DbAdapter {
  constructor(private pool: Pool) {}

  async query<T = Record<string, unknown>>(
    sql: string,
    params?: unknown[],
  ): Promise<T[]> {
    const result = await this.pool.query(sql, params);
    return result.rows as T[];
  }

  async queryOne<T = Record<string, unknown>>(
    sql: string,
    params?: unknown[],
  ): Promise<T | null> {
    const result = await this.pool.query(sql, params);
    return (result.rows[0] as T) ?? null;
  }

  async execute(sql: string, params?: unknown[]): Promise<void> {
    await this.pool.query(sql, params);
  }

  async transaction<T>(fn: (tx: BaseDbAdapter) => Promise<T>): Promise<T> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const txAdapter = new PgDbAdapterTx(client);
      const result = await fn(txAdapter as unknown as BaseDbAdapter);
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

  async query<T = Record<string, unknown>>(
    sql: string,
    params?: unknown[],
  ): Promise<T[]> {
    const result = await this.client.query(sql, params);
    return result.rows as T[];
  }

  async queryOne<T = Record<string, unknown>>(
    sql: string,
    params?: unknown[],
  ): Promise<T | null> {
    const result = await this.client.query(sql, params);
    return (result.rows[0] as T) ?? null;
  }

  async execute(sql: string, params?: unknown[]): Promise<void> {
    await this.client.query(sql, params);
  }

  async transaction<T>(fn: (tx: BaseDbAdapter) => Promise<T>): Promise<T> {
    // Nested transaction — just run inline (Postgres savepoints omitted for brevity)
    return fn(this as unknown as BaseDbAdapter);
  }
}

class HttpKafkaProducerAdapter implements KafkaProducerAdapter {
  constructor(private brokerUrl: string) {}

  async publish(topic: string, key: string, value: unknown): Promise<void> {
    if (!this.brokerUrl) {
      // No-op for tests / dev when KAFKA_BROKER_URL is not set
      return;
    }
    try {
      await fetch(`${this.brokerUrl}/topics/${topic}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/vnd.kafka.json.v2+json' },
        body: JSON.stringify({
          records: [{ key, value: JSON.stringify(value) }],
        }),
      });
    } catch (err) {
      console.error(`[referral-system] Kafka publish failed (topic=${topic}):`, err);
    }
  }
}

export function getServiceDeps(): ServiceDeps {
  if (!global._referralSystemDeps) {
    if (!process.env.DATABASE_URL) {
      throw new Error('DATABASE_URL environment variable is not set');
    }

    const pool = new Pool({ connectionString: process.env.DATABASE_URL });
    const db = new PgDbAdapter(pool);
    const kafka = new HttpKafkaProducerAdapter(process.env.KAFKA_BROKER_URL || '');
    const baseUrl = process.env.REFERRAL_BASE_URL || 'https://tixly.cz';

    global._referralSystemDeps = { db, kafka, baseUrl };
  }

  return global._referralSystemDeps;
}
