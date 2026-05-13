// pricing.ts — typy pro modul AI Dynamic Pricing.
// Všechny peněžní hodnoty v haléřích (INTEGER).

export interface DemandSignals {
  eventId: string;
  ticketTypeId: string;
  // Current state
  currentPriceHalire: number;
  basePriceHalire: number;
  soldCount: number;
  totalCapacity: number;
  soldPercentage: number;
  // Velocity
  salesLast1h: number;
  salesLast24h: number;
  salesLast7d: number;
  avgDailySales7d: number;
  // Time
  daysUntilEvent: number;
  hoursUntilEvent: number;
  // External
  competitorPriceHalire: number | null;
  weatherForecast: string | null; // sunny/rainy/etc
  dayOfWeek: number; // 0=Sun
  isWeekend: boolean;
}

export type PricingStrategy =
  | 'static'
  | 'early_bird'
  | 'demand_curve'
  | 'time_decay'
  | 'surge';

export interface PricingRule {
  strategy: PricingStrategy;
  /** Min price — never go below this (floor) */
  minPriceHalire: number;
  /** Max price — never exceed this (cap) */
  maxPriceHalire: number;
  /** Early bird: discount % when < X% sold */
  earlyBirdDiscountPct: number;
  earlyBirdThresholdPct: number; // e.g. 20 = first 20% of capacity
  /** Surge: multiplier when velocity > threshold */
  surgeMultiplier: number; // e.g. 1.5
  surgeVelocityThreshold: number; // sales/hour to trigger
  /** Time decay: price increases as event approaches */
  timeDecayStartDays: number; // e.g. 30
  timeDecayMaxIncreasePct: number; // e.g. 50 = up to 50% above base
}

export interface PriceRecommendation {
  ticketTypeId: string;
  currentPriceHalire: number;
  recommendedPriceHalire: number;
  deltaHalire: number;
  deltaPct: number;
  strategy: PricingStrategy;
  reasons: string[];
  confidence: number; // 0-100
  shouldAutoApply: boolean; // true if within auto-adjust threshold
}

export const DEFAULT_PRICING_RULE: PricingRule = {
  strategy: 'demand_curve',
  minPriceHalire: 0,
  maxPriceHalire: 99_999_900, // ~1M Kč
  earlyBirdDiscountPct: 15,
  earlyBirdThresholdPct: 20,
  surgeMultiplier: 1.3,
  surgeVelocityThreshold: 10, // 10+ sales/hour = surge
  timeDecayStartDays: 30,
  timeDecayMaxIncreasePct: 40,
};
