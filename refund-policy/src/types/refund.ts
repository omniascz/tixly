export type RefundPolicyType =
  | 'no_refund'
  | 'full_refund'
  | 'partial_refund'
  | 'tiered_refund'
  | 'credit_only';

export type RefundMethod =
  | 'original_payment'
  | 'platform_credit'
  | 'both_allowed';

export type RefundRequestStatus = 'pending' | 'approved' | 'rejected' | 'processed';

export interface RefundPolicyTier {
  id: string;
  minDaysBefore: number;
  refundPct: number;      // 10000 = 100 %
  label: string | null;
  sortOrder: number;
}

export interface RefundPolicy {
  id: string;
  promoterId: string;
  name: string;
  policyType: RefundPolicyType;
  refundPercentage: number | null;  // pro partial_refund
  refundMethod: RefundMethod;
  allowSelfService: boolean;
  minDaysBeforeEvent: number | null;
  maxDaysAfterPurchase: number | null;
  isDefault: boolean;
  isActive: boolean;
  tiers: RefundPolicyTier[];        // pro tiered_refund
  createdAt: string;
  updatedAt: string;
}

export type RefundEligibilityCode =
  | 'POLICY_NO_REFUND'
  | 'DEADLINE_PASSED'
  | 'PURCHASE_WINDOW_EXPIRED';

export interface RefundEligibility {
  eligible: boolean;
  refundableAmount: number;   // haléře — kolik lze vrátit
  refundMethod: RefundMethod;
  requiresRequest: boolean;   // false = self-service, true = musí podat žádost
  reason: string | null;      // proč není eligible (pokud eligible=false)
  code: RefundEligibilityCode | null;  // strojově čitelný kód důvodu ineligibility
  appliedTier: RefundPolicyTier | null;  // pro tiered policy
  policyId: string;
}

export interface RefundRequest {
  id: string;
  orderId: string;
  ticketId: string | null;
  promoterId: string;
  userId: string;
  reason: string;
  requestedAmount: number | null;
  status: RefundRequestStatus;
  decidedBy: string | null;
  decidedAt: string | null;
  decisionNotes: string | null;
  refundedAmount: number | null;
  refundMethod: RefundMethod | null;
  processedAt: string | null;
  createdAt: string;
}
