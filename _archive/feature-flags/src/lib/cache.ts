import type { FlagStore, FeatureFlag } from './types.js';

interface CacheEntry {
  value: FeatureFlag | null;
  expiresAt: number;
}

export function createCachedStore(store: FlagStore, ttlMs: number = 5000): FlagStore {
  const cache = new Map<string, CacheEntry>();

  function isExpired(entry: CacheEntry): boolean {
    return Date.now() > entry.expiresAt;
  }

  // LRU eviction: pokud cache > 1000, smaž nejstarší
  function evictIfNeeded() {
    if (cache.size > 1000) {
      const firstKey = cache.keys().next().value;
      if (firstKey) cache.delete(firstKey);
    }
  }

  return {
    async getFlag(key: string): Promise<FeatureFlag | null> {
      const entry = cache.get(key);
      if (entry && !isExpired(entry)) return entry.value;

      const value = await store.getFlag(key);
      evictIfNeeded();
      cache.set(key, { value, expiresAt: Date.now() + ttlMs });
      return value;
    },
    async setFlag(flag: FeatureFlag): Promise<void> {
      await store.setFlag(flag);
      cache.set(flag.key, { value: flag, expiresAt: Date.now() + ttlMs });
    },
    async deleteFlag(key: string): Promise<void> {
      await store.deleteFlag(key);
      cache.delete(key);
    },
    async listFlags(): Promise<FeatureFlag[]> {
      return store.listFlags();
    },
  };
}
