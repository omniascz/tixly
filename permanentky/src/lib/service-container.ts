// =============================================================================
// Service Container — Permanentky
//
// Pattern: stripe-payments / venue-ownership / promoter-onboarding
// =============================================================================

import type { DbAdapter } from '@tixly/db-adapter';

export type { DbAdapter } from '@tixly/db-adapter';

export interface KafkaAdapter {
  emit(topic: string, payload: Record<string, unknown>): Promise<void>;
}

export interface ServiceDeps {
  db: DbAdapter;
  kafka: KafkaAdapter;
}

declare global {
  // eslint-disable-next-line no-var
  var _permanentkyDeps: ServiceDeps | undefined;
}

class NoopKafka implements KafkaAdapter {
  async emit(_topic: string, _payload: Record<string, unknown>): Promise<void> {
    // no-op default; wire a real Kafka client in production bootstrap
  }
}

export function getServiceDeps(): ServiceDeps {
  if (!globalThis._permanentkyDeps) {
    // Lazy-loaded to keep test environments free of runtime pg imports.
    // In production bootstrap, set globalThis._permanentkyDeps explicitly.
    const { PgDbAdapter } = require('@tixly/db-adapter') as {
      PgDbAdapter: new (connectionString: string) => DbAdapter;
    };
    const db = new PgDbAdapter(
      process.env.DATABASE_URL ?? 'postgres://localhost/tixly'
    );
    globalThis._permanentkyDeps = {
      db,
      kafka: new NoopKafka(),
    };
  }
  return globalThis._permanentkyDeps;
}

export function setServiceDeps(deps: ServiceDeps): void {
  globalThis._permanentkyDeps = deps;
}
