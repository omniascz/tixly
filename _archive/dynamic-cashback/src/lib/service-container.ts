// service-container.ts — DI kontejner pro Dynamic Cashback modul.

import type { DbAdapter } from '@tixly/rls-multitenancy';

export interface KafkaAdapter {
  send(topic: string, payload: unknown): Promise<void>;
}

export interface ServiceDeps {
  db: DbAdapter;
  kafka: KafkaAdapter;
}

// Lazy imports — aby testy mohly mockovat bez nutnosti nastartovat pg.
async function createDefaultDeps(): Promise<ServiceDeps> {
  const { PgDbAdapter } = await import('@tixly/db-adapter');
  const db = new PgDbAdapter({
    connectionString: process.env.DATABASE_URL ?? '',
  }) as unknown as DbAdapter;

  const kafkaUrl = process.env.KAFKA_HTTP_URL ?? '';
  const kafka: KafkaAdapter = {
    async send(topic: string, payload: unknown): Promise<void> {
      if (!kafkaUrl) return;
      try {
        await fetch(`${kafkaUrl}/produce`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ topic, payload }),
        });
      } catch {
        /* best-effort */
      }
    },
  };

  return { db, kafka };
}

interface GlobalWithDeps {
  _dynamicCashbackDeps?: ServiceDeps;
}

export async function getServiceDeps(): Promise<ServiceDeps> {
  const g = globalThis as unknown as GlobalWithDeps;
  if (!g._dynamicCashbackDeps) {
    g._dynamicCashbackDeps = await createDefaultDeps();
  }
  return g._dynamicCashbackDeps;
}

export function setServiceDeps(deps: ServiceDeps): void {
  (globalThis as unknown as GlobalWithDeps)._dynamicCashbackDeps = deps;
}
