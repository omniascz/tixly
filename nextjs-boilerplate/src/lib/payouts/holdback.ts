/**
 * Chargeback holdback — tier-based defaults with per-promotér override.
 *
 * Účel: Tixly drží X % z payoutu Y dní, aby pokryl pozdní chargebacky
 * (Visa/MC dispute window 60-180 dní). Bez holdback nese veškeré riziko Tixly.
 *
 * Tier defaults:
 *   T1 (nový):        5 % po 90 dní  — vyšší riziko, žádná historie
 *   T2 (ověřený):     3 % po 60 dní  — středně bezpečné
 *   T3 (premium):     0 % po 0 dní   — důvěryhodný, velký objem
 *   T4 (enterprise):  0 % po 0 dní   — custom, individuální dohoda
 *
 * Override per promotér přes platform.promoters.chargeback_holdback_pct
 * a .chargeback_holdback_days (migrace 265). NULL = tier default.
 */

export interface HoldbackPolicy {
  /** Basis points (500 = 5 %). */
  pctBps: number;
  /** Dní po payoutu, kdy se rezerva uvolní. */
  retentionDays: number;
}

const TIER_DEFAULTS: Record<number, HoldbackPolicy> = {
  1: { pctBps: 500, retentionDays: 90 },
  2: { pctBps: 300, retentionDays: 60 },
  3: { pctBps: 0, retentionDays: 0 },
  4: { pctBps: 0, retentionDays: 0 },
};

/**
 * Spočítá efektivní policy pro promotéra.
 *
 * @param tier 1-4 z platform.promoters.tier
 * @param overridePctBps NULL = use tier default, jinak explicit value
 * @param overrideDays NULL = use tier default, jinak explicit value
 */
export function getEffectiveHoldback(
  tier: number,
  overridePctBps: number | null,
  overrideDays: number | null,
): HoldbackPolicy {
  const defaults = TIER_DEFAULTS[tier] ?? TIER_DEFAULTS[1];
  return {
    pctBps: overridePctBps ?? defaults.pctBps,
    retentionDays: overrideDays ?? defaults.retentionDays,
  };
}

/**
 * Spočítá holdback amount v halířích.
 *
 * @param grossHalire hrubá tržba před fees a refundy
 * @param policy efektivní policy z getEffectiveHoldback
 */
export function computeHoldbackAmount(
  grossHalire: number,
  policy: HoldbackPolicy,
): number {
  if (policy.pctBps === 0 || grossHalire <= 0) return 0;
  return Math.floor((grossHalire * policy.pctBps) / 10000);
}

/**
 * Spočítá release_date pro novou rezervu.
 */
export function computeReleaseDate(policy: HoldbackPolicy, payoutDate: Date = new Date()): Date {
  const release = new Date(payoutDate);
  release.setDate(release.getDate() + policy.retentionDays);
  return release;
}
