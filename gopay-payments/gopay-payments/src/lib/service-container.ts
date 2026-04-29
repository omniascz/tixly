// =============================================================================
// Service Container — GoPay Payments
//
// Vzor: venue-ownership/src/lib/service-container.ts
// Poskytuje DI adaptéry pro DB + Kafka a singleton GopayHttpClient.
// =============================================================================

import { Pool, PoolClient } from 'pg';
import type { DbAdapter } from '@tixly/db-adapter';
import { GopayHttpClient } from './gopay-client.js';
import { loadGopayConfig, type GopayConfig } from './gopay-config.js';

export type { DbAdapter } from '@tixly/db-adapter';

export interface KafkaProducerAdapter {
  send(topic: string, payload: unknown): Promise<void>;
}

export interface ServiceDeps {
  db: DbAdapter;
  kafka: KafkaProducerAdapter;
  gopay: GopayHttpClient;
  config: GopayConfig;
}

declare global {
  // eslint-disable-next-line no-var
  var _gopayPaymentsDeps: ServiceDeps | undefined;
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
    (this as unknown as { pool: unknown }).pool = {
      query: (sql: string, params?: unknown[]) => client.query(sql, params),
    };
  }
}

class HttpKafkaProducerAdapter implements KafkaProducerAdapter {
  constructor(private brokerUrl: string) {}

  async send(topic: string, payload: unknown): Promise<void> {
    if (!this.brokerUrl) {
      return;
    }
    try {
      await fetch(`${this.brokerUrl}/topics/${topic}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/vnd.kafka.json.v2+json' },
        body: JSON.stringify({
          records: [{ value: JSON.stringify(payload) }],
        }),
      });
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error(`Failed to send Kafka message to topic ${topic}:`, err);
    }
  }
}

export function getServiceDeps(): ServiceDeps {
  if (!process.env['DATABASE_URL']) {
    throw new Error('DATABASE_URL environment variable is not set');
  }

  if (!global._gopayPaymentsDeps) {
    const pool = new Pool({ connectionString: process.env['DATABASE_URL'] });
    const db = new PgDbAdapter(pool);
    const kafka = new HttpKafkaProducerAdapter(process.env['KAFKA_BROKER_URL'] ?? '');
    const config = loadGopayConfig();
    const gopay = new GopayHttpClient(config);

    global._gopayPaymentsDeps = { db, kafka, gopay, config };
  }

  return global._gopayPaymentsDeps;
}
