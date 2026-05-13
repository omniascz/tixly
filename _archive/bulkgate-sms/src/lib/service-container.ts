// =============================================================================
// Service container — singleton DB / Kafka / BulkGate
// =============================================================================

import { Pool } from 'pg';
import { BulkgateClient } from './bulkgate-client.js';
import { loadBulkgateConfig } from './bulkgate-config.js';
import type {
  ServiceDeps,
  SmsDbAdapter,
  KafkaProducer,
  DbQueryResult,
} from '../services/sms.service.js';

declare global {
  // eslint-disable-next-line no-var
  var _bulkgateSmsDeps: ServiceDeps | undefined;
}

// ---------------------------------------------------------------------------
// Production adapters
// ---------------------------------------------------------------------------

class PgDbAdapter implements SmsDbAdapter {
  constructor(private pool: Pool) {}

  async query<T = Record<string, unknown>>(
    sql: string,
    params: unknown[] = [],
  ): Promise<DbQueryResult<T>> {
    const res = await this.pool.query(sql, params as unknown[]);
    return {
      rows: res.rows as T[],
      rowCount: res.rowCount ?? 0,
    };
  }
}

class HttpKafkaProducerAdapter implements KafkaProducer {
  constructor(private baseUrl: string) {}

  async publish(
    topic: string,
    key: string,
    payload: Record<string, unknown>,
  ): Promise<void> {
    try {
      await fetch(`${this.baseUrl}/publish`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ topic, key, payload }),
      });
    } catch (err) {
      console.error(
        `[bulkgate-sms] Kafka publish failed (${topic}):`,
        err instanceof Error ? err.message : err,
      );
    }
  }
}

// ---------------------------------------------------------------------------
// Singleton factory
// ---------------------------------------------------------------------------

let pool: Pool | undefined;

export function getServiceDeps(): ServiceDeps {
  if (global._bulkgateSmsDeps) {
    return global._bulkgateSmsDeps;
  }

  pool ??= new Pool({
    connectionString: process.env.DATABASE_URL,
    max: 10,
  });

  const db = new PgDbAdapter(pool);
  const kafka = new HttpKafkaProducerAdapter(
    process.env.KAFKA_REST_URL ?? 'http://localhost:8082',
  );
  const bulkgate = new BulkgateClient(loadBulkgateConfig());

  const deps: ServiceDeps = { db, kafka, bulkgate };
  global._bulkgateSmsDeps = deps;
  return deps;
}
