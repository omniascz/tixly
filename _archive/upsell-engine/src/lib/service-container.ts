export type { DbAdapter } from '@tixly/db-adapter';
import type { DbAdapter } from '@tixly/db-adapter';

export interface RedisAdapter {
  incr(key: string): Promise<number>;
  get(key: string): Promise<string | null>;
  setex(key: string, seconds: number, value: string): Promise<void>;
}

export interface KafkaProducerAdapter {
  send(topic: string, payload: unknown): Promise<void>;
}

export interface ServiceDeps {
  db: DbAdapter;
  redis: RedisAdapter;
  kafka: KafkaProducerAdapter;
}
