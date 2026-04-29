import type { FeatureFlag, FlagStore, FlagEvaluationContext } from '../lib/types.js';
import { evaluateFlag } from '../lib/flag-evaluator.js';

export async function upsertFlag(
  key: string,
  data: Partial<Omit<FeatureFlag, 'key' | 'createdAt' | 'updatedAt'>>,
  store: FlagStore,
): Promise<FeatureFlag> {
  const existing = await store.getFlag(key);
  const now = new Date().toISOString();
  const flag: FeatureFlag = {
    key,
    status: data.status ?? existing?.status ?? 'disabled',
    rolloutPercentage: data.rolloutPercentage ?? existing?.rolloutPercentage,
    enabledTenants: data.enabledTenants ?? existing?.enabledTenants,
    disabledTenants: data.disabledTenants ?? existing?.disabledTenants,
    description: data.description ?? existing?.description,
    createdAt: existing?.createdAt ?? now,
    updatedAt: now,
  };
  await store.setFlag(flag);
  return flag;
}

export async function disableFlag(key: string, store: FlagStore): Promise<void> {
  const existing = await store.getFlag(key);
  if (!existing) return;
  await store.setFlag({ ...existing, status: 'disabled', updatedAt: new Date().toISOString() });
}

export async function isEnabled(
  key: string,
  context: FlagEvaluationContext,
  store: FlagStore,
): Promise<boolean> {
  const flag = await store.getFlag(key);
  if (!flag) return false; // safe default — flag neexistuje = disabled
  return evaluateFlag(flag, context);
}

export async function getEnabledFlags(
  keys: string[],
  context: FlagEvaluationContext,
  store: FlagStore,
): Promise<Record<string, boolean>> {
  const results: Record<string, boolean> = {};
  await Promise.all(
    keys.map(async (key) => {
      results[key] = await isEnabled(key, context, store);
    })
  );
  return results;
}

export async function listFlags(store: FlagStore): Promise<FeatureFlag[]> {
  return store.listFlags();
}

export async function deleteFlag(key: string, store: FlagStore): Promise<void> {
  await store.deleteFlag(key);
}

export async function setRolloutPercentage(
  key: string,
  percentage: number,
  store: FlagStore,
): Promise<FeatureFlag> {
  if (percentage < 0 || percentage > 100) throw new Error('Percentage must be 0-100');
  return upsertFlag(key, { status: 'gradual', rolloutPercentage: percentage }, store);
}
