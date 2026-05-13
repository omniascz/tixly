import type { PricingRule } from '../types/venue-rental.types';

/**
 * Calculate rental price based on booking duration and pricing rules.
 *
 * Priority:
 *   1. full_day rule if hours >= 8
 *   2. half_day rule if hours >= 4
 *   3. hour rule * hours
 */
export function calculateRentalPrice(hours: number, rules: PricingRule[]): number {
  const fullDayRule = rules.find((r) => r.unit === 'full_day');
  if (fullDayRule && hours >= 8) {
    return fullDayRule.priceCzk;
  }

  const halfDayRule = rules.find((r) => r.unit === 'half_day');
  if (halfDayRule && hours >= 4) {
    return halfDayRule.priceCzk;
  }

  const hourRule = rules.find((r) => r.unit === 'hour');
  if (hourRule) {
    return hourRule.priceCzk * hours;
  }

  return 0;
}
