export type {
  FlagStatus,
  FeatureFlag,
  FlagEvaluationContext,
  FlagStore,
  RedisClient,
} from './lib/types.js';

export { hashToPercentage, evaluateFlag } from './lib/flag-evaluator.js';
export { createRedisStore } from './lib/redis-store.js';
export { createCachedStore } from './lib/cache.js';

export {
  upsertFlag,
  disableFlag,
  isEnabled,
  getEnabledFlags,
  listFlags,
  deleteFlag,
  setRolloutPercentage,
} from './services/feature-flags.service.js';
