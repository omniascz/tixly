import type { PricingRule, PricingPhase } from '../types/pricing';

/**
 * Factory function to create a PricingRule with sensible defaults.
 * Override any properties as needed for specific test cases.
 */
export function createPricingRule(overrides?: Partial<PricingRule>): PricingRule {
  return {
    id: 'rule-default',
    ticketTypeId: 'tt-default',
    phase: 'regular',
    price: 400,
    thresholdQty: null,
    thresholdDate: null,
    demandFactorMin: 1.0,
    demandFactorMax: 1.5,
    priority: 20,
    active: true,
    ...overrides,
  };
}

/**
 * Creates a complete set of 4 pricing rules (early_bird, regular, late, door)
 * with sensible defaults for a given reference date.
 * Phases are ordered: early_bird (priority 10) → regular (priority 20) → late (priority 30) → door (priority 40)
 */
export function createPhaseSet(now: Date): PricingRule[] {
  const oneHourAgo = new Date(now.getTime() - 1000 * 60 * 60);
  const tomorrowMinus2h = new Date(now.getTime() + 1000 * 60 * 60 * 22);
  const tomorrowMinus1h = new Date(now.getTime() + 1000 * 60 * 60 * 23);
  const tomorrow2pm = new Date(now.getTime() + 1000 * 60 * 60 * 26);

  return [
    createPricingRule({
      id: 'rule-early-bird',
      phase: 'early_bird',
      price: 100,
      thresholdQty: 100,
      thresholdDate: oneHourAgo,
      demandFactorMin: 0.9,
      demandFactorMax: 1.1,
      priority: 10,
      active: true,
    }),
    createPricingRule({
      id: 'rule-regular',
      phase: 'regular',
      price: 200,
      thresholdQty: 300,
      thresholdDate: oneHourAgo,
      demandFactorMin: 1.0,
      demandFactorMax: 1.3,
      priority: 20,
      active: true,
    }),
    createPricingRule({
      id: 'rule-late',
      phase: 'late',
      price: 300,
      thresholdQty: 400,
      thresholdDate: tomorrowMinus2h,
      demandFactorMin: 1.1,
      demandFactorMax: 1.8,
      priority: 30,
      active: true,
    }),
    createPricingRule({
      id: 'rule-door',
      phase: 'door',
      price: 500,
      thresholdQty: null,
      thresholdDate: tomorrowMinus1h,
      demandFactorMin: 1.2,
      demandFactorMax: 2.0,
      priority: 40,
      active: true,
    }),
  ];
}

/**
 * Creates a mock TicketType object for testing price calculations.
 */
export function createTicketType(overrides?: Partial<{
  id: string;
  eventId: string;
  name: string;
  kind: string;
  basePrice: number;
  totalQty: number;
  remainingQty: number;
  maxPerUser: number;
  zone: string | null;
}>) {
  return {
    id: 'tt-default',
    eventId: 'evt-default',
    name: 'Standard Ticket',
    kind: 'standard',
    basePrice: 400,
    totalQty: 500,
    remainingQty: 300,
    maxPerUser: 5,
    zone: null,
    ...overrides,
  };
}
