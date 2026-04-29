// =============================================================================
// BNPL Eligibility — pure stateless function
//
// Checks whether a user may take on a new BNPL obligation.
// =============================================================================

import type {
  BnplEligibilityResult,
  BnplPayment,
  BnplProvider,
} from '../types/bnpl.types';

// ---------------------------------------------------------------------------
// Limits
// ---------------------------------------------------------------------------

/** Minimum BNPL amount: 200 CZK = 20 000 haléřů */
export const MIN_AMOUNT_CZK = 200_00;

/** Maximum BNPL amount per payment: 50 000 CZK = 5 000 000 haléřů */
export const MAX_AMOUNT_CZK = 50_000_00;

/** Max simultaneous active/approved BNPL payments per user */
export const MAX_ACTIVE_PAYMENTS = 3;

/** Max total outstanding BNPL obligations in CZK (haléře) */
export const MAX_TOTAL_ACTIVE_CZK = 100_000_00;

// ---------------------------------------------------------------------------
// checkEligibility
// ---------------------------------------------------------------------------

export function checkEligibility(
  _userId: string,
  amountCzk: number,
  _provider: BnplProvider,
  pastPayments: BnplPayment[],
): BnplEligibilityResult {
  // 1. Hard block: any overdue or defaulted payment → not eligible.
  const hasBadStanding = pastPayments.some(
    (p) => p.status === 'overdue' || p.status === 'defaulted',
  );
  if (hasBadStanding) {
    return {
      eligible: false,
      reason: 'User has overdue or defaulted BNPL payments.',
      maxAmountCzk: 0,
    };
  }

  // 2. Count active obligations (active + approved).
  const activePayments = pastPayments.filter(
    (p) => p.status === 'active' || p.status === 'approved',
  );

  if (activePayments.length >= MAX_ACTIVE_PAYMENTS) {
    return {
      eligible: false,
      reason: `User has reached the maximum number of active BNPL payments (${MAX_ACTIVE_PAYMENTS}).`,
      maxAmountCzk: 0,
    };
  }

  const totalActiveAmount = activePayments.reduce((sum, p) => sum + p.amountCzk, 0);
  const remainingCapacity = MAX_TOTAL_ACTIVE_CZK - totalActiveAmount;

  if (remainingCapacity <= 0) {
    return {
      eligible: false,
      reason: 'User has reached the maximum total BNPL exposure limit.',
      maxAmountCzk: 0,
    };
  }

  // 3. Check amount bounds vs. remaining capacity + global limits.
  if (amountCzk < MIN_AMOUNT_CZK) {
    return {
      eligible: false,
      reason: `Amount is below the minimum of ${MIN_AMOUNT_CZK} haléřů.`,
      maxAmountCzk: Math.min(MAX_AMOUNT_CZK, remainingCapacity),
    };
  }

  if (amountCzk > MAX_AMOUNT_CZK) {
    return {
      eligible: false,
      reason: `Amount exceeds the per-payment maximum of ${MAX_AMOUNT_CZK} haléřů.`,
      maxAmountCzk: Math.min(MAX_AMOUNT_CZK, remainingCapacity),
    };
  }

  if (amountCzk > remainingCapacity) {
    return {
      eligible: false,
      reason: 'Amount would exceed the user’s remaining BNPL capacity.',
      maxAmountCzk: remainingCapacity,
    };
  }

  // 4. All good.
  return {
    eligible: true,
    reason: null,
    maxAmountCzk: Math.min(MAX_AMOUNT_CZK, remainingCapacity),
  };
}
