export type InsurancePremiumTier = 'tier_1' | 'tier_2' | 'tier_3' | 'tier_4';

export type InsurancePolicyStatus =
  | 'active'
  | 'claimed'
  | 'paid_out'
  | 'expired'
  | 'cancelled'
  | 'rejected';

export type InsuranceClaimStatus =
  | 'pending'
  | 'under_review'
  | 'approved'
  | 'rejected';

export type InsuranceClaimReason =
  | 'illness'
  | 'injury'
  | 'bereavement'
  | 'transport_failure'
  | 'work_emergency'
  | 'cancellation';

export interface InsurancePolicy {
  id: string;
  ticket_id: string;
  order_id: string;
  user_id: string;
  /** Cena pojišťované vstupenky v haléřích */
  ticket_price: number;
  /** Zaplacené pojistné v haléřích */
  premium_amount: number;
  /** Maximální výplata (= ticket_price) v haléřích */
  coverage_amount: number;
  status: InsurancePolicyStatus;
  /** Datum akce + 7 dní */
  claim_deadline: Date;
  created_at: Date;
}

export interface InsuranceClaim {
  id: string;
  policy_id: string;
  user_id: string;
  reason: InsuranceClaimReason;
  /** Popis situace (max 500 znaků) */
  description: string;
  /** Odkaz na přiložený dokument */
  evidence_url: string | null;
  status: InsuranceClaimStatus;
  submitted_at: Date;
  reviewed_at: Date | null;
  /** Admin user ID */
  reviewed_by: string | null;
  rejection_reason: string | null;
  /** Výplatní částka v haléřích */
  payout_amount: number | null;
  payout_at: Date | null;
}

export interface InsuranceQuote {
  ticket_price: number;
  premium_amount: number;
  coverage_amount: number;
  tier: InsurancePremiumTier;
  /** Např. "Pojistné 69 Kč — krytí až 1 500 Kč" */
  description: string;
}

// ---------------------------------------------------------------------------
// Typed errors
// ---------------------------------------------------------------------------

export class InsurancePolicyNotFoundError extends Error {
  readonly code = 'INSURANCE_POLICY_NOT_FOUND' as const;
  constructor(policyId: string) {
    super(`Insurance policy not found: ${policyId}`);
    this.name = 'InsurancePolicyNotFoundError';
  }
}

export class InsuranceClaimNotFoundError extends Error {
  readonly code = 'INSURANCE_CLAIM_NOT_FOUND' as const;
  constructor(claimId: string) {
    super(`Insurance claim not found: ${claimId}`);
    this.name = 'InsuranceClaimNotFoundError';
  }
}

export class InsuranceClaimDeadlinePassedError extends Error {
  readonly code = 'INSURANCE_CLAIM_DEADLINE_PASSED' as const;
  constructor(deadline: Date) {
    super(`Claim deadline has passed: ${deadline.toISOString()}`);
    this.name = 'InsuranceClaimDeadlinePassedError';
  }
}

export class InsuranceAlreadyClaimedError extends Error {
  readonly code = 'INSURANCE_ALREADY_CLAIMED' as const;
  constructor(message = 'A claim or policy already exists') {
    super(message);
    this.name = 'InsuranceAlreadyClaimedError';
  }
}

export class InsuranceInvalidStatusError extends Error {
  readonly code = 'INSURANCE_INVALID_STATUS' as const;
  constructor(currentStatus: InsurancePolicyStatus) {
    super(`Policy is not in a valid state for this operation (current: ${currentStatus})`);
    this.name = 'InsuranceInvalidStatusError';
  }
}

export class InsuranceUnauthorizedError extends Error {
  readonly code = 'INSURANCE_UNAUTHORIZED' as const;
  constructor() {
    super('Unauthorized access to insurance resource');
    this.name = 'InsuranceUnauthorizedError';
  }
}
