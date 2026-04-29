// ---------------------------------------------------------------------------
// Adapter factory — wire up real DB + Kafka implementations here.
// Replace the stubs below with actual Postgres / KafkaJS clients.
// ---------------------------------------------------------------------------

import type { GuestListDbAdapter, KafkaProducerAdapter } from '../services/guest-list.service.js';

function createDbAdapter(): GuestListDbAdapter {
  throw new Error('GuestListDbAdapter not implemented. Wire a real adapter in src/lib/adapters.ts.');
}

function createKafkaAdapter(): KafkaProducerAdapter {
  throw new Error('KafkaProducerAdapter not implemented. Wire a real adapter in src/lib/adapters.ts.');
}

export function getAdapters(): { db: GuestListDbAdapter; kafka: KafkaProducerAdapter } {
  return {
    db: createDbAdapter(),
    kafka: createKafkaAdapter(),
  };
}
