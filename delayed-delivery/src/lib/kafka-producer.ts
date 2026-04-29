// Placeholder Kafka producer factory.
// Replace with a real KafkaJS / Confluent implementation at integration time.

import type { KafkaProducerAdapter } from '../services/delayed-delivery.service';

// ---------------------------------------------------------------------------
// Factory — swap this for your real producer in production
// ---------------------------------------------------------------------------

let _producer: KafkaProducerAdapter | null = null;

export function getKafkaProducer(): KafkaProducerAdapter {
  if (_producer) return _producer;
  throw new Error(
    '[delayed-delivery] Kafka producer not initialised. ' +
      'Call setKafkaProducer(producer) at application startup.',
  );
}

export function setKafkaProducer(producer: KafkaProducerAdapter): void {
  _producer = producer;
}
