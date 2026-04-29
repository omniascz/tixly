import type {
  InsuranceClaimReason,
  InsurancePolicy,
  InsurancePremiumTier,
  InsuranceQuote,
} from '../types/insurance.types';

// ---------------------------------------------------------------------------
// Premium tiers (all amounts in haléře)
// ---------------------------------------------------------------------------

interface PremiumTierDefinition {
  tier: InsurancePremiumTier;
  maxPrice: number | null; // null = no upper bound
  premium: number;
  /** Human-readable max coverage label in Kč */
  coverageLabel: string;
}

const PREMIUM_TIERS: PremiumTierDefinition[] = [
  { tier: 'tier_1', maxPrice: 50000,  premium: 3900,  coverageLabel: '500' },
  { tier: 'tier_2', maxPrice: 150000, premium: 6900,  coverageLabel: '1 500' },
  { tier: 'tier_3', maxPrice: 500000, premium: 12900, coverageLabel: '5 000' },
  { tier: 'tier_4', maxPrice: null,   premium: 24900, coverageLabel: '∞' },
];

const VALID_CLAIM_REASONS = new Set<InsuranceClaimReason>([
  'illness',
  'injury',
  'bereavement',
  'transport_failure',
  'work_emergency',
  'cancellation',
]);

// ---------------------------------------------------------------------------
// calculatePremium
// ---------------------------------------------------------------------------

/**
 * Returns an InsuranceQuote for a given ticket price (in haléře).
 * Thresholds:
 *   ≤ 500 Kč (50 000 h)  → tier_1, 39 Kč premium
 *   501–1 500 Kč          → tier_2, 69 Kč premium
 *   1 501–5 000 Kč        → tier_3, 129 Kč premium
 *   > 5 000 Kč            → tier_4, 249 Kč premium
 */
export function calculatePremium(ticketPrice: number): InsuranceQuote {
  const tier = PREMIUM_TIERS.find(
    (t) => t.maxPrice === null || ticketPrice <= t.maxPrice,
  );

  if (!tier) {
    // Fallback — should never happen because tier_4 has no upper bound
    throw new Error('Unable to determine premium tier');
  }

  const premiumKc = tier.premium / 100;
  const description = `Pojistné ${premiumKc} Kč — krytí až ${tier.coverageLabel} Kč`;

  return {
    ticket_price: ticketPrice,
    premium_amount: tier.premium,
    coverage_amount: ticketPrice,
    tier: tier.tier,
    description,
  };
}

// ---------------------------------------------------------------------------
// calculateClaimDeadline
// ---------------------------------------------------------------------------

/**
 * Returns the claim deadline: eventDate + 7 calendar days.
 * Does not mutate the input date.
 */
export function calculateClaimDeadline(eventDate: Date): Date {
  const deadline = new Date(eventDate.getTime());
  deadline.setDate(deadline.getDate() + 7);
  return deadline;
}

// ---------------------------------------------------------------------------
// isPolicyClaimable
// ---------------------------------------------------------------------------

/**
 * Returns true if the policy can accept a claim:
 *  - status must be 'active'
 *  - now must be on or before claim_deadline
 */
export function isPolicyClaimable(policy: InsurancePolicy, now: Date): boolean {
  return policy.status === 'active' && now <= policy.claim_deadline;
}

// ---------------------------------------------------------------------------
// validateClaimReason
// ---------------------------------------------------------------------------

/**
 * Type guard — returns true when reason is a recognised InsuranceClaimReason.
 */
export function validateClaimReason(reason: string): reason is InsuranceClaimReason {
  return VALID_CLAIM_REASONS.has(reason as InsuranceClaimReason);
}

// ---------------------------------------------------------------------------
// formatInsuranceOffer
// ---------------------------------------------------------------------------

/**
 * Returns a human-readable insurance offer string for display in the checkout UI.
 */
export function formatInsuranceOffer(
  quote: InsuranceQuote,
  lang: 'cs' | 'en',
): string {
  const premiumKc = Math.round(quote.premium_amount / 100);

  if (lang === 'en') {
    return `Insure your ticket for ${premiumKc} CZK — full refund if you're ill or injured`;
  }

  return `Pojistit vstupenku za ${premiumKc} Kč — plná náhrada při nemoci nebo úrazu`;
}
