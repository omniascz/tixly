// kafka.ts — Kafka adapter singleton pro loyalty-points modul.
// Fire-and-forget: chyby jsou záměrně ignorovány v service vrstvě.
// V produkci nahradit za @tixly/kafka-client nebo kafkajs.

import type { ServiceDeps } from '../services/loyalty.service';

type KafkaAdapter = ServiceDeps['kafka'];

function buildKafkaAdapter(): KafkaAdapter {
  return {
    async send(topic: string, payload: unknown): Promise<void> {
      // Stub: v produkci připojit kafkajs producera
      // Producer by měl být singleton s connection poolem
      if (process.env['NODE_ENV'] === 'development') {
        // eslint-disable-next-line no-console
        console.log(`[Kafka stub] topic=${topic}`, payload);
      }
    },
  };
}

let _kafka: KafkaAdapter | null = null;

export function getKafka(): KafkaAdapter {
  if (!_kafka) {
    _kafka = buildKafkaAdapter();
  }
  return _kafka;
}
