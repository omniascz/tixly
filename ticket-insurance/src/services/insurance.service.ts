import {
  calculateClaimDeadline,
  calculatePremium,
  isPolicyClaimable,
  validateClaimReason,
} from '../lib/insurance-calculator';
import type {
  InsuranceClaim,
  InsuranceClaimReason,
  InsurancePolicy,
  InsuranceQuote,
} from '../types/insurance.types';
import {
  InsuranceAlreadyClaimedError,
  InsuranceClaimDeadlinePassedError,
  InsuranceClaimNotFoundError,
  InsuranceInvalidStatusError,
  InsurancePolicyNotFoundError,
  InsuranceUnauthorizedError,
} from '../types/insurance.types';

// ---------------------------------------------------------------------------
// Database adapter interface
// ---------------------------------------------------------------------------

export interface InsuranceDbAdapter {
  findPolicy(id: string): Promise<InsurancePolicy | null>;
  findPolicyByTicket(ticketId: string): Promise<InsurancePolicy | null>;
  createPolicy(
    data: Omit<InsurancePolicy, 'id' | 'created_at'>,
  ): Promise<InsurancePolicy>;
  updatePolicyStatus(
    id: string,
    status: InsurancePolicy['status'],
    tx?: unknown,
  ): Promise<void>;

  findClaim(id: string): Promise<InsuranceClaim | null>;
  findClaimByPolicy(policyId: string): Promise<InsuranceClaim | null>;
  createClaim(data: Omit<InsuranceClaim, 'id'>): Promise<InsuranceClaim>;
  updateClaim(
    id: string,
    data: Partial<InsuranceClaim>,
    tx?: unknown,
  ): Promise<InsuranceClaim>;

  listPoliciesByUser(userId: string): Promise<InsurancePolicy[]>;
  /** Returns all pending + under_review claims for admin review queue */
  listPendingClaims(): Promise<InsuranceClaim[]>;
  /** Returns approved claims whose payout_at is still NULL (pending payout execution) */
  listApprovedPendingPayouts(): Promise<InsuranceClaim[]>;
  /** Returns active policies whose claim_deadline has passed (for expiry cron) */
  listExpiredActivePolicies(asOf: Date): Promise<InsurancePolicy[]>;
  withTransaction<T>(fn: (tx: unknown) => Promise<T>): Promise<T>;
}

// ---------------------------------------------------------------------------
// Submit claim input
// ---------------------------------------------------------------------------

export interface SubmitClaimInput {
  reason: string;
  description: string;
  evidenceUrl?: string;
}

// ---------------------------------------------------------------------------
// InsuranceService
// ---------------------------------------------------------------------------

export const InsuranceService = {
  // -------------------------------------------------------------------------
  // getQuote — pure, no DB
  // -------------------------------------------------------------------------

  getQuote(ticketPrice: number): InsuranceQuote {
    return calculatePremium(ticketPrice);
  },

  // -------------------------------------------------------------------------
  // purchaseInsurance
  // -------------------------------------------------------------------------

  async purchaseInsurance(
    ticketId: string,
    orderId: string,
    userId: string,
    ticketPrice: number,
    eventDate: Date,
    db: InsuranceDbAdapter,
  ): Promise<InsurancePolicy> {
    const existing = await db.findPolicyByTicket(ticketId);
    if (existing) {
      throw new InsuranceAlreadyClaimedError(
        `A policy already exists for ticket ${ticketId}`,
      );
    }

    const quote = calculatePremium(ticketPrice);
    const claimDeadline = calculateClaimDeadline(eventDate);

    return db.createPolicy({
      ticket_id: ticketId,
      order_id: orderId,
      user_id: userId,
      ticket_price: ticketPrice,
      premium_amount: quote.premium_amount,
      coverage_amount: quote.coverage_amount,
      status: 'active',
      claim_deadline: claimDeadline,
    });
  },

  // -------------------------------------------------------------------------
  // submitClaim
  // -------------------------------------------------------------------------

  async submitClaim(
    policyId: string,
    userId: string,
    data: SubmitClaimInput,
    db: InsuranceDbAdapter,
  ): Promise<InsuranceClaim> {
    const policy = await db.findPolicy(policyId);
    if (!policy) {
      throw new InsurancePolicyNotFoundError(policyId);
    }
    if (policy.user_id !== userId) {
      throw new InsuranceUnauthorizedError();
    }

    const now = new Date();
    if (!isPolicyClaimable(policy, now)) {
      if (policy.status !== 'active') {
        throw new InsuranceInvalidStatusError(policy.status);
      }
      throw new InsuranceClaimDeadlinePassedError(policy.claim_deadline);
    }

    const existingClaim = await db.findClaimByPolicy(policyId);
    if (existingClaim) {
      throw new InsuranceAlreadyClaimedError(
        `A claim already exists for policy ${policyId}`,
      );
    }

    if (!validateClaimReason(data.reason)) {
      throw new Error(`Invalid claim reason: ${data.reason}`);
    }

    const reason: InsuranceClaimReason = data.reason;

    return db.withTransaction(async (tx) => {
      const claim = await db.createClaim({
        policy_id: policyId,
        user_id: userId,
        reason,
        description: data.description,
        evidence_url: data.evidenceUrl ?? null,
        status: 'pending',
        submitted_at: now,
        reviewed_at: null,
        reviewed_by: null,
        rejection_reason: null,
        payout_amount: null,
        payout_at: null,
      });

      await db.updatePolicyStatus(policyId, 'claimed', tx);

      return claim;
    });
  },

  // -------------------------------------------------------------------------
  // approveClaim
  // -------------------------------------------------------------------------

  async approveClaim(
    claimId: string,
    adminUserId: string,
    db: InsuranceDbAdapter,
  ): Promise<InsuranceClaim> {
    const claim = await db.findClaim(claimId);
    if (!claim) {
      throw new InsuranceClaimNotFoundError(claimId);
    }

    const policy = await db.findPolicy(claim.policy_id);
    if (!policy) {
      throw new InsurancePolicyNotFoundError(claim.policy_id);
    }

    return db.withTransaction(async (tx) => {
      const updated = await db.updateClaim(
        claimId,
        {
          status: 'approved',
          reviewed_at: new Date(),
          reviewed_by: adminUserId,
          payout_amount: policy.coverage_amount,
        },
        tx,
      );

      await db.updatePolicyStatus(policy.id, 'paid_out', tx);

      return updated;
    });
  },

  // -------------------------------------------------------------------------
  // rejectClaim
  // -------------------------------------------------------------------------

  async rejectClaim(
    claimId: string,
    adminUserId: string,
    reason: string,
    db: InsuranceDbAdapter,
  ): Promise<InsuranceClaim> {
    const claim = await db.findClaim(claimId);
    if (!claim) {
      throw new InsuranceClaimNotFoundError(claimId);
    }

    const policy = await db.findPolicy(claim.policy_id);
    if (!policy) {
      throw new InsurancePolicyNotFoundError(claim.policy_id);
    }

    return db.withTransaction(async (tx) => {
      const updated = await db.updateClaim(
        claimId,
        {
          status: 'rejected',
          reviewed_at: new Date(),
          reviewed_by: adminUserId,
          rejection_reason: reason,
        },
        tx,
      );

      await db.updatePolicyStatus(policy.id, 'rejected', tx);

      return updated;
    });
  },

  // -------------------------------------------------------------------------
  // cancelPolicy
  // -------------------------------------------------------------------------

  async cancelPolicy(
    policyId: string,
    userId: string,
    db: InsuranceDbAdapter,
  ): Promise<void> {
    const policy = await db.findPolicy(policyId);
    if (!policy) {
      throw new InsurancePolicyNotFoundError(policyId);
    }
    if (policy.user_id !== userId) {
      throw new InsuranceUnauthorizedError();
    }
    if (policy.status !== 'active') {
      throw new InsuranceInvalidStatusError(policy.status);
    }

    await db.updatePolicyStatus(policyId, 'cancelled');
  },

  // -------------------------------------------------------------------------
  // listUserPolicies
  // -------------------------------------------------------------------------

  async listUserPolicies(
    userId: string,
    db: InsuranceDbAdapter,
  ): Promise<InsurancePolicy[]> {
    return db.listPoliciesByUser(userId);
  },

  // -------------------------------------------------------------------------
  // listPendingClaims (admin)
  // -------------------------------------------------------------------------

  async listPendingClaims(
    _adminUserId: string,
    db: InsuranceDbAdapter,
  ): Promise<InsuranceClaim[]> {
    return db.listPendingClaims();
  },

  // -------------------------------------------------------------------------
  // processClaimPayout — mark approved claim as paid out (payout executed)
  // -------------------------------------------------------------------------
  //
  // Called either by the payout cron or manually by an admin after the actual
  // money transfer has been initiated externally. Validates the claim is in
  // 'approved' state with payout_at still NULL and payout_amount set.

  async processClaimPayout(
    claimId: string,
    _adminUserId: string,
    db: InsuranceDbAdapter,
  ): Promise<InsuranceClaim> {
    const claim = await db.findClaim(claimId);
    if (!claim) {
      throw new InsuranceClaimNotFoundError(claimId);
    }
    if (claim.status !== 'approved') {
      throw new Error(
        `Claim ${claimId} is not approved (current: ${claim.status})`,
      );
    }
    if (claim.payout_at !== null) {
      // Already processed — idempotent
      return claim;
    }
    if (claim.payout_amount === null || claim.payout_amount <= 0) {
      throw new Error(`Claim ${claimId} has no payout amount`);
    }

    return db.updateClaim(claimId, { payout_at: new Date() });
  },

  // -------------------------------------------------------------------------
  // processPendingPayouts — batch payout cron
  // -------------------------------------------------------------------------

  async processPendingPayouts(
    adminUserId: string,
    db: InsuranceDbAdapter,
  ): Promise<{ processed: number; claims: InsuranceClaim[] }> {
    const pending = await db.listApprovedPendingPayouts();
    const results: InsuranceClaim[] = [];
    for (const claim of pending) {
      try {
        const updated = await InsuranceService.processClaimPayout(
          claim.id,
          adminUserId,
          db,
        );
        results.push(updated);
      } catch (err) {
        console.error(`[insurance] payout failed for claim ${claim.id}:`, err);
      }
    }
    return { processed: results.length, claims: results };
  },

  // -------------------------------------------------------------------------
  // expireStalePolicies — transition active policies past claim_deadline to expired
  // -------------------------------------------------------------------------

  async expireStalePolicies(
    db: InsuranceDbAdapter,
  ): Promise<{ expired: number }> {
    const now = new Date();
    const stale = await db.listExpiredActivePolicies(now);
    let expired = 0;
    for (const policy of stale) {
      try {
        await db.updatePolicyStatus(policy.id, 'expired');
        expired++;
      } catch (err) {
        console.error(`[insurance] expiry failed for policy ${policy.id}:`, err);
      }
    }
    return { expired };
  },
};
