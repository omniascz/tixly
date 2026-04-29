// points-calculator.ts — čisté funkce pro výpočty věrnostních bodů.
// Žádné side-effecty, žádné IO — snadno testovatelné.

import {
  type LoyaltyTier,
  TIER_THRESHOLDS,
  TIER_MULTIPLIERS,
} from '../types/loyalty.types';

// ---------------------------------------------------------------------------
// calculateEarnedPoints
// ---------------------------------------------------------------------------

/**
 * Vypočítá počet bodů za nákup.
 *
 * Vzorec: Math.floor(orderAmount / 100 × multiplier)
 *   - orderAmount je v haléřích → /100 převede na Kč
 *   - multiplier závisí na aktuálním tieru zákazníka
 *   - výsledek je celé číslo (žádné desetinné body)
 *
 * @param orderAmount - částka objednávky v haléřích (integer)
 * @param tier        - aktuální tier zákazníka
 * @returns počet bodů (integer ≥ 0)
 *
 * @example
 *   calculateEarnedPoints(150_00, 'silver') // 150 × 1.5 = 225
 *   calculateEarnedPoints(9999, 'bronze')   // 99 × 1 = 99 (ořez haléřů)
 */
export function calculateEarnedPoints(
  orderAmount: number,
  tier: LoyaltyTier,
): number {
  if (orderAmount <= 0) return 0;
  // TIER_MULTIPLIERS jsou násobky 0.5 (1, 1.5, 2, 3) — aby se vyhnulo float
  // nepřesnostem, násobíme ×10 a dělíme 1000 místo /100 × multiplier.
  // Ekvivalent: Math.floor(orderAmount * multiplier / 100)
  const multiplierX10 = Math.round(TIER_MULTIPLIERS[tier] * 10); // 10, 15, 20, 30
  return Math.floor((orderAmount * multiplierX10) / 1000);
}

// ---------------------------------------------------------------------------
// getTier
// ---------------------------------------------------------------------------

/**
 * Vrátí tier odpovídající danému počtu lifetimePoints.
 * Tier se NIKDY nepočítá z totalPoints (aktuálního zůstatku),
 * vždy z lifetimePoints — zabrání degradaci kvůli expiracím/redemptions.
 *
 * Algoritmus: iteruje prahy od nejvyššího dolů, vrátí první splněný.
 *
 * @param lifetimePoints - celkový součet všech earned transakcí
 * @returns aktuální tier
 */
export function getTier(lifetimePoints: number): LoyaltyTier {
  // Prahy seřazené sestupně
  const tiers: LoyaltyTier[] = ['platinum', 'gold', 'silver', 'bronze'];
  for (const tier of tiers) {
    if (lifetimePoints >= TIER_THRESHOLDS[tier]) {
      return tier;
    }
  }
  return 'bronze';
}

// ---------------------------------------------------------------------------
// calculateDiscount
// ---------------------------------------------------------------------------

/**
 * Převede body na slevu v haléřích.
 * Pravidlo: 100 bodů = 1 Kč = 100 haléřů
 *
 * @param points - počet bodů k uplatnění (integer ≥ 0)
 * @returns sleva v haléřích (integer)
 *
 * @example
 *   calculateDiscount(500)   // 500 haléřů = 5 Kč
 *   calculateDiscount(1250)  // 1250 haléřů = 12,50 Kč
 *   calculateDiscount(0)     // 0
 */
export function calculateDiscount(points: number): number {
  if (points <= 0) return 0;
  return points; // 100 bodů = 100 haléřů; body === haléře
}

// ---------------------------------------------------------------------------
// calculateExpiryDate
// ---------------------------------------------------------------------------

/**
 * Vypočítá datum expirace bodů jako from + 12 měsíců.
 * Používá UTC pro konzistenci bez ohledu na časové pásmo serveru.
 *
 * @param from - výchozí datum (obvykle now při nákupu)
 * @returns datum expirace
 */
export function calculateExpiryDate(from: Date): Date {
  return new Date(
    Date.UTC(
      from.getUTCFullYear(),
      from.getUTCMonth() + 12,
      from.getUTCDate(),
      from.getUTCHours(),
      from.getUTCMinutes(),
      from.getUTCSeconds(),
      from.getUTCMilliseconds(),
    ),
  );
}
