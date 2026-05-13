import { Pool, PoolClient } from 'pg';
import { FioClient, loadFioConfig, type FioConfig } from './fio-client.js';
import { loadSpaydConfig, type SpaydConfig } from './spayd-generator.js';

export type { DbAdapter } from '@tixly/db-adapter';
import type { DbAdapter } from '@tixly/db-adapter';

export interface KafkaProducerAdapter {
  send(topic: string, payload: unknown): Promise<void>;
}

export interface ServiceDeps {
  db: DbAdapter;
  kafka: KafkaProducerAdapter;
  fioClient: FioClient;
  fioConfig: FioConfig;
  spaydConfig: SpaydConfig;
}

declare global {
  // eslint-disable-next-line no-var
  var _bankReconciliationDeps: ServiceDeps | undefined;
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

class HttpKafkaProducerAdapter implements KafkaProducerAdapter {
  constructor(private brokerUrl: string) {}

  async send(topic: string, payload: unknown): Promise<void> {
    if (!this.brokerUrl) return;
    try {
      await fetch(`${this.brokerUrl}/topics/${topic}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/vnd.kafka.json.v2+json' },
        body: JSON.stringify({
          records: [{ value: JSON.stringify(payload) }],
        }),
      });
    } catch (err) {
      console.error(`Failed to send Kafka message to topic ${topic}:`, err);
    }
  }
}

export function getServiceDeps(): ServiceDeps {
  if (!process.env.DATABASE_URL) {
    throw new Error('DATABASE_URL environment variable is not set');
  }

  if (!global._bankReconciliationDeps) {
    const pool = new Pool({ connectionString: process.env.DATABASE_URL });
    const db = new PgDbAdapter(pool);
    const kafka = new HttpKafkaProducerAdapter(process.env.KAFKA_BROKER_URL || '');
    const fioConfig = loadFioConfig();
    const fioClient = new FioClient(fioConfig);
    const spaydConfig = loadSpaydConfig();

    global._bankReconciliationDeps = { db, kafka, fioClient, fioConfig, spaydConfig };
  }

  return global._bankReconciliationDeps;
}
