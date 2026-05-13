import type { ReferralClick, LinearAttributionShare } from '../types/referral.types';

// ============================================================
// Multi-touch Attribution — pure calculation functions
//
// Všechny peněžní hodnoty jsou v INTEGER haléřích.
// ============================================================

/** Conversion window in days (business rule) */
export const CONVERSION_WINDOW_DAYS = 30;

/**
 * Return true when a click occurred within the allowed conversion window
 * relative to the conversion event.
 */
export function isWithinConversionWindow(
  clickAt: Date,
  conversionAt: Date,
  windowDays: number = CONVERSION_WINDOW_DAYS,
): boolean {
  const windowMs = windowDays * 24 * 60 * 60 * 1000;
  const diffMs = conversionAt.getTime() - clickAt.getTime();
  return diffMs >= 0 && diffMs <= windowMs;
}

/**
 * Last-click attribution: return the most recent click within the conversion
 * window, or null if no qualifying click exists.
 */
export function getLastClickAttribution(
  clicks: ReferralClick[],
  conversionAt: Date = new Date(),
  windowDays: number = CONVERSION_WINDOW_DAYS,
): ReferralClick | null {
  const eligible = clicks.filter((c) =>
    isWithinConversionWindow(c.occurredAt, conversionAt, windowDays),
  );

  if (eligible.length === 0) return null;

  return eligible.reduce((latest, c) =>
    c.occurredAt > latest.occurredAt ? c : latest,
  );
}

/**
 * First-click attribution: return the oldest click within the conversion
 * window, or null if no qualifying click exists.
 */
export function getFirstClickAttribution(
  clicks: ReferralClick[],
  conversionAt: Date = new Date(),
  windowDays: number = CONVERSION_WINDOW_DAYS,
): ReferralClick | null {
  const eligible = clicks.filter((c) =>
    isWithinConversionWindow(c.occurredAt, conversionAt, windowDays),
  );

  if (eligible.length === 0) return null;

  return eligible.reduce((oldest, c) =>
    c.occurredAt < oldest.occurredAt ? c : oldest,
  );
}

/**
 * Linear attribution: distribute the commission equally across all qualifying
 * clicks. Each share is a whole-haléř amount. Any remainder from integer
 * division is added to the last entry (so the sum always equals totalHalire).
 *
 * @param clicks        All candidate clicks
 * @param totalHalire   Total commission amount in haléře to distribute
 * @param conversionAt  Reference point for the window check (defaults to now)
 * @param windowDays    Conversion window override
 */
export function getLinearAttribution(
  clicks: ReferralClick[],
  totalHalire: number,
  conversionAt: Date = new Date(),
  windowDays: number = CONVERSION_WINDOW_DAYS,
): LinearAttributionShare[] {
  if (!Number.isInteger(totalHalire) || totalHalire < 0) {
    throw new Error(`totalHalire must be a non-negative integer, got ${totalHalire}`);
  }

  const eligible = clicks.filter((c) =>
    isWithinConversionWindow(c.occurredAt, conversionAt, windowDays),
  );

  if (eligible.length === 0) return [];

  const base = Math.floor(totalHalire / eligible.length);
  const remainder = totalHalire - base * eligible.length;

  return eligible.map((c, idx) => ({
    linkId: c.linkId,
    clickId: c.id,
    // Distribute remainder into the last share so the sum equals totalHalire
    amountHalire: idx === eligible.length - 1 ? base + remainder : base,
  }));
}

/**
 * Calculate commission amount in whole haléře using basis points.
 *
 * @param orderAmountHalire  Order total in haléře
 * @param rateBps            Commission rate in basis points (500 = 5.00 %)
 */
export function calculateCommission(
  orderAmountHalire: number,
  rateBps: number,
): number {
  if (!Number.isInteger(orderAmountHalire) || orderAmountHalire < 0) {
    throw new Error(
      `orderAmountHalire must be a non-negative integer, got ${orderAmountHalire}`,
    );
  }
  if (!Number.isInteger(rateBps) || rateBps < 0 || rateBps > 10_000) {
    throw new Error(`rateBps must be an integer in [0, 10000], got ${rateBps}`);
  }
  return Math.floor((orderAmountHalire * rateBps) / 10_000);
}
