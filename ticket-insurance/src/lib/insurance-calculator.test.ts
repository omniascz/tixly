import { describe, expect, it } from 'vitest';
import {
  calculateClaimDeadline,
  calculatePremium,
  formatInsuranceOffer,
  isPolicyClaimable,
  validateClaimReason,
} from './insurance-calculator';
import type { InsurancePolicy } from '../types/insurance.types';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makePolicy(
  overrides: Partial<InsurancePolicy> = {},
): InsurancePolicy {
  return {
    id: 'pol_1',
    ticket_id: 'tkt_1',
    order_id: 'ord_1',
    user_id: 'usr_1',
    ticket_price: 50000,
    premium_amount: 3900,
    coverage_amount: 50000,
    status: 'active',
    claim_deadline: new Date('2026-05-10T23:59:59Z'),
    created_at: new Date('2026-04-01T10:00:00Z'),
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// calculatePremium
// ---------------------------------------------------------------------------

describe('calculatePremium', () => {
  it('returns tier_1 and 39 Kč premium for price exactly 500 Kč (50 000 h)', () => {
    const q = calculatePremium(50000);
    expect(q.tier).toBe('tier_1');
    expect(q.premium_amount).toBe(3900);
    expect(q.coverage_amount).toBe(50000);
  });

  it('returns tier_1 for a low price (100 Kč)', () => {
    const q = calculatePremium(10000);
    expect(q.tier).toBe('tier_1');
    expect(q.premium_amount).toBe(3900);
  });

  it('returns tier_2 and 69 Kč premium for price exactly 501 Kč (50 100 h)', () => {
    const q = calculatePremium(50100);
    expect(q.tier).toBe('tier_2');
    expect(q.premium_amount).toBe(6900);
  });

  it('returns tier_2 for price exactly 1 500 Kč (150 000 h)', () => {
    const q = calculatePremium(150000);
    expect(q.tier).toBe('tier_2');
    expect(q.premium_amount).toBe(6900);
  });

  it('returns tier_3 and 129 Kč premium for price exactly 1 501 Kč (150 100 h)', () => {
    const q = calculatePremium(150100);
    expect(q.tier).toBe('tier_3');
    expect(q.premium_amount).toBe(12900);
  });

  it('returns tier_3 for price exactly 5 000 Kč (500 000 h)', () => {
    const q = calculatePremium(500000);
    expect(q.tier).toBe('tier_3');
    expect(q.premium_amount).toBe(12900);
  });

  it('returns tier_4 and 249 Kč premium for price exactly 5 001 Kč (500 100 h)', () => {
    const q = calculatePremium(500100);
    expect(q.tier).toBe('tier_4');
    expect(q.premium_amount).toBe(24900);
  });

  it('returns tier_4 for a very high price (100 000 Kč)', () => {
    const q = calculatePremium(10000000);
    expect(q.tier).toBe('tier_4');
    expect(q.premium_amount).toBe(24900);
  });

  it('sets coverage_amount equal to ticket_price', () => {
    const price = 75000;
    const q = calculatePremium(price);
    expect(q.coverage_amount).toBe(price);
  });

  it('sets ticket_price on the quote', () => {
    const price = 120000;
    const q = calculatePremium(price);
    expect(q.ticket_price).toBe(price);
  });

  it('includes a non-empty description string', () => {
    const q = calculatePremium(50000);
    expect(q.description.length).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// calculateClaimDeadline
// ---------------------------------------------------------------------------

describe('calculateClaimDeadline', () => {
  it('adds exactly 7 days to the event date', () => {
    const event = new Date('2026-05-03T20:00:00Z');
    const deadline = calculateClaimDeadline(event);
    expect(deadline).toEqual(new Date('2026-05-10T20:00:00Z'));
  });

  it('does not mutate the input date', () => {
    const event = new Date('2026-06-01T10:00:00Z');
    const original = event.getTime();
    calculateClaimDeadline(event);
    expect(event.getTime()).toBe(original);
  });

  it('handles a leap-year date correctly (Feb 22 → Mar 1)', () => {
    const event = new Date('2028-02-23T00:00:00Z'); // 2028 is a leap year
    const deadline = calculateClaimDeadline(event);
    expect(deadline).toEqual(new Date('2028-03-01T00:00:00Z'));
  });

  it('crosses a month boundary correctly (Jan 28 → Feb 4)', () => {
    const event = new Date('2026-01-28T12:00:00Z');
    const deadline = calculateClaimDeadline(event);
    expect(deadline).toEqual(new Date('2026-02-04T12:00:00Z'));
  });
});

// ---------------------------------------------------------------------------
// isPolicyClaimable
// ---------------------------------------------------------------------------

describe('isPolicyClaimable', () => {
  it('returns true for active policy before deadline', () => {
    const policy = makePolicy({ claim_deadline: new Date('2026-05-10T23:59:59Z') });
    const now = new Date('2026-05-10T12:00:00Z');
    expect(isPolicyClaimable(policy, now)).toBe(true);
  });

  it('returns true for active policy exactly at the deadline', () => {
    const deadline = new Date('2026-05-10T23:59:59Z');
    const policy = makePolicy({ claim_deadline: deadline });
    expect(isPolicyClaimable(policy, deadline)).toBe(true);
  });

  it('returns false for active policy one millisecond after deadline', () => {
    const deadline = new Date('2026-05-10T23:59:59Z');
    const policy = makePolicy({ claim_deadline: deadline });
    const now = new Date(deadline.getTime() + 1);
    expect(isPolicyClaimable(policy, now)).toBe(false);
  });

  it('returns false for cancelled policy before deadline', () => {
    const policy = makePolicy({
      status: 'cancelled',
      claim_deadline: new Date('2026-05-10T23:59:59Z'),
    });
    const now = new Date('2026-05-01T10:00:00Z');
    expect(isPolicyClaimable(policy, now)).toBe(false);
  });

  it('returns false for claimed policy', () => {
    const policy = makePolicy({
      status: 'claimed',
      claim_deadline: new Date('2026-05-10T23:59:59Z'),
    });
    expect(isPolicyClaimable(policy, new Date('2026-05-01T10:00:00Z'))).toBe(false);
  });

  it('returns false for paid_out policy', () => {
    const policy = makePolicy({
      status: 'paid_out',
      claim_deadline: new Date('2026-05-10T23:59:59Z'),
    });
    expect(isPolicyClaimable(policy, new Date('2026-05-01T10:00:00Z'))).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// validateClaimReason
// ---------------------------------------------------------------------------

describe('validateClaimReason', () => {
  const validReasons = [
    'illness',
    'injury',
    'bereavement',
    'transport_failure',
    'work_emergency',
  ] as const;

  validReasons.forEach((reason) => {
    it(`accepts valid reason "${reason}"`, () => {
      expect(validateClaimReason(reason)).toBe(true);
    });
  });

  it('rejects "changed_plans"', () => {
    expect(validateClaimReason('changed_plans')).toBe(false);
  });

  it('rejects "forgot"', () => {
    expect(validateClaimReason('forgot')).toBe(false);
  });

  it('rejects empty string', () => {
    expect(validateClaimReason('')).toBe(false);
  });

  it('rejects arbitrary string', () => {
    expect(validateClaimReason('bad_reason')).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// formatInsuranceOffer
// ---------------------------------------------------------------------------

describe('formatInsuranceOffer', () => {
  const quote39 = calculatePremium(10000); // tier_1 → 39 Kč

  it('returns Czech string for lang=cs with correct premium', () => {
    const result = formatInsuranceOffer(quote39, 'cs');
    expect(result).toBe('Pojistit vstupenku za 39 Kč — plná náhrada při nemoci nebo úrazu');
  });

  it('returns English string for lang=en with correct premium', () => {
    const result = formatInsuranceOffer(quote39, 'en');
    expect(result).toBe("Insure your ticket for 39 CZK — full refund if you're ill or injured");
  });

  it('shows correct premium for tier_2 (69 Kč) in Czech', () => {
    const quote = calculatePremium(100000); // tier_2
    const result = formatInsuranceOffer(quote, 'cs');
    expect(result).toContain('69 Kč');
  });

  it('shows correct premium for tier_3 (129 Kč) in English', () => {
    const quote = calculatePremium(200000); // tier_3
    const result = formatInsuranceOffer(quote, 'en');
    expect(result).toContain('129 CZK');
  });

  it('shows correct premium for tier_4 (249 Kč) in Czech', () => {
    const quote = calculatePremium(600000); // tier_4
    const result = formatInsuranceOffer(quote, 'cs');
    expect(result).toContain('249 Kč');
  });
});
