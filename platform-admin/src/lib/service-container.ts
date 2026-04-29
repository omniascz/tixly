export type { DbAdapter } from '@tixly/db-adapter';
import type { DbAdapter } from '@tixly/db-adapter';

export interface RedisAdapter {
  get(key: string): Promise<string | null>;
  setex(key: string, seconds: number, value: string): Promise<void>;
  del(key: string): Promise<void>;
}

export interface ServiceDeps {
  db: DbAdapter;
  redis: RedisAdapter;
}
