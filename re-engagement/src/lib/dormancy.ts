import type { DormancyLevel } from '../types/re-engagement.types';

// ─── Constants ────────────────────────────────────────────────────────────────

const MS_PER_DAY = 1000 * 60 * 60 * 24;

const AT_RISK_THRESHOLD = 60;   // days — start of at_risk
const DORMANT_THRESHOLD = 90;   // days — start of dormant
const CHURNED_THRESHOLD = 180;  // days — start of churned

// ─── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Returns the number of whole days elapsed between lastPurchaseAt and now.
 * Always non-negative (returns 0 if now < lastPurchaseAt due to clock skew).
 */
export function getDaysSinceLastPurchase(
  lastPurchaseAt: Date,
  now: Date,
): number {
  const diffMs = now.getTime() - lastPurchaseAt.getTime();
  return Math.max(0, Math.floor(diffMs / MS_PER_DAY));
}

/**
 * Maps days-since-last-purchase to a DormancyLevel, or null if the user
 * is still active (fewer than 60 days since last purchase).
 *
 *   < 60  days  → null       (active, no campaign needed)
 *   60–89 days  → 'at_risk'
 *   90–179 days → 'dormant'
 *   180+  days  → 'churned'
 */
export function getDormancyLevel(
  lastPurchaseAt: Date,
  now: Date,
): DormancyLevel | null {
  const days = getDaysSinceLastPurchase(lastPurchaseAt, now);

  if (days >= CHURNED_THRESHOLD) return 'churned';
  if (days >= DORMANT_THRESHOLD) return 'dormant';
  if (days >= AT_RISK_THRESHOLD) return 'at_risk';
  return null;
}
