import type { FlagStore, FeatureFlag, RedisClient } from './types.js';

const KEY_PREFIX = 'ff:';

export function createRedisStore(redis: RedisClient): FlagStore {
  return {
    async getFlag(key: string): Promise<FeatureFlag | null> {
      const raw = await redis.get(`${KEY_PREFIX}${key}`);
      return raw ? JSON.parse(raw) : null;
    },
    async setFlag(flag: FeatureFlag): Promise<void> {
      await redis.set(`${KEY_PREFIX}${flag.key}`, JSON.stringify(flag));
    },
    async deleteFlag(key: string): Promise<void> {
      await redis.del(`${KEY_PREFIX}${key}`);
    },
    async listFlags(): Promise<FeatureFlag[]> {
      const keys = await redis.keys(`${KEY_PREFIX}*`);
      const flags: FeatureFlag[] = [];
      for (const k of keys) {
        const raw = await redis.get(k);
        if (raw) flags.push(JSON.parse(raw));
      }
      return flags;
    },
  };
}
