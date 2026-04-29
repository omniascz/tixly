import type { FeatureFlag, FlagEvaluationContext } from './types.js';

// Deterministický hash → 0-99 (djb2 algoritmus)
export function hashToPercentage(tenantId: string, flagKey: string): number {
  const input = `${tenantId}:${flagKey}`;
  let hash = 5381;
  for (let i = 0; i < input.length; i++) {
    hash = ((hash << 5) + hash) + input.charCodeAt(i);
    hash = hash & 0x7fffffff; // keep positive 32-bit
  }
  return hash % 100;
}

export function evaluateFlag(flag: FeatureFlag, context: FlagEvaluationContext): boolean {
  const tenantId = context.tenantId ?? context.userId ?? '';

  // disabledTenants má nejvyšší prioritu
  if (flag.disabledTenants?.includes(tenantId)) return false;

  // enabledTenants override gradual
  if (flag.enabledTenants?.includes(tenantId)) return true;

  switch (flag.status) {
    case 'enabled': return true;
    case 'disabled': return false;
    case 'gradual': {
      const percentage = flag.rolloutPercentage ?? 0;
      if (percentage >= 100) return true;
      if (percentage <= 0) return false;
      return hashToPercentage(tenantId, flag.key) < percentage;
    }
    default: return false;
  }
}
