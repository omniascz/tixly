// Tier-based reward engine for ambassadors.
//
// Tiers are derived from lifetime conversions. Each tier has a commission rate
// (in basis points) plus an optional flat bonus per conversion (in haléře).
//
// Milestones are separate: one-off bonuses when ambassador reaches a specific
// conversion count (e.g. 10th, 50th, 100th conversion).

export type AmbassadorTier = 'starter' | 'influencer' | 'star';

export interface TierConfig {
  tier: AmbassadorTier;
  /** Lifetime conversions required to reach this tier (inclusive). */
  minConversions: number;
  /** Commission rate as basis points (1000 = 10 %). */
  rateBps: number;
  /** Flat bonus per conversion in haléře (0 = none). */
  flatBonusHalire: number;
}

export interface MilestoneConfig {
  /** Conversion count that triggers the bonus (e.g. 10 = on the 10th conversion). */
  atConversion: number;
  /** One-off bonus in haléře. */
  bonusHalire: number;
  /** Human-readable label. */
  label: string;
}

export const DEFAULT_TIERS: TierConfig[] = [
  { tier: 'starter',    minConversions: 0,   rateBps: 500,  flatBonusHalire: 0 },
  { tier: 'influencer', minConversions: 25,  rateBps: 1000, flatBonusHalire: 5000 },
  { tier: 'star',       minConversions: 100, rateBps: 1500, flatBonusHalire: 10000 },
];

export const DEFAULT_MILESTONES: MilestoneConfig[] = [
  { atConversion: 10,  bonusHalire: 50_000,  label: '10 konverzí — 500 Kč bonus' },
  { atConversion: 50,  bonusHalire: 250_000, label: '50 konverzí — 2500 Kč bonus' },
  { atConversion: 100, bonusHalire: 500_000, label: '100 konverzí — 5000 Kč bonus' },
];

/**
 * Resolve the tier for a given lifetime conversion count.
 * Walks tiers sorted by `minConversions` descending and returns the first match.
 */
export function computeTier(
  lifetimeConversions: number,
  tiers: TierConfig[] = DEFAULT_TIERS,
): TierConfig {
  if (!Number.isInteger(lifetimeConversions) || lifetimeConversions < 0) {
    throw new RangeError('lifetimeConversions musí být nezáporné celé číslo');
  }
  if (tiers.length === 0) {
    throw new RangeError('tiers nesmí být prázdné');
  }
  const sorted = [...tiers].sort((a, b) => b.minConversions - a.minConversions);
  for (const t of sorted) {
    if (lifetimeConversions >= t.minConversions) return t;
  }
  // Fallback — lowest tier (e.g. if lowest has minConversions > 0).
  return sorted[sorted.length - 1];
}

/**
 * Compute reward for a single conversion given tier config.
 * All amounts in haléře (integer).
 */
export function computeReward(
  orderAmountHalire: number,
  tier: TierConfig,
): { commissionHalire: number; flatBonusHalire: number; totalHalire: number } {
  if (!Number.isInteger(orderAmountHalire) || orderAmountHalire < 0) {
    throw new RangeError('orderAmountHalire musí být nezáporné celé číslo');
  }
  const commissionHalire = Math.floor((orderAmountHalire * tier.rateBps) / 10_000);
  const flatBonusHalire = tier.flatBonusHalire;
  return {
    commissionHalire,
    flatBonusHalire,
    totalHalire: commissionHalire + flatBonusHalire,
  };
}

/**
 * Return all milestones that were crossed when lifetime count moved from
 * `previousCount` to `newCount`. Usually this is a single milestone but the
 * API supports batch increments.
 */
export function checkMilestones(
  previousCount: number,
  newCount: number,
  milestones: MilestoneConfig[] = DEFAULT_MILESTONES,
): MilestoneConfig[] {
  if (newCount <= previousCount) return [];
  return milestones.filter(
    (m) => m.atConversion > previousCount && m.atConversion <= newCount,
  );
}
