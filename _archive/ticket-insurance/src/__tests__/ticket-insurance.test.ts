import { describe, it, expect, vi, beforeEach } from 'vitest';
import { InsuranceService } from '../services/insurance.service';
import type { InsuranceDbAdapter } from '../services/insurance.service';
import type { InsurancePolicy, InsuranceClaim, InsuranceQuote } from '../types/insurance.types';
import {
  InsuranceAlreadyClaimedError,
  InsuranceClaimDeadlinePassedError,
  InsuranceClaimNotFoundError,
  InsuranceInvalidStatusError,
  InsurancePolicyNotFoundError,
  InsuranceUnauthorizedError,
} from '../types/insurance.types';

// ---------------------------------------------------------------------------
// Mock DB Adapter
// ---------------------------------------------------------------------------

function makeMockDb(): InsuranceDbAdapter {
  return {
    findPolicy: vi.fn(),
    findPolicyByTicket: vi.fn(),
    createPolicy: vi.fn(),
    updatePolicyStatus: vi.fn(),
    findClaim: vi.fn(),
    findClaimByPolicy: vi.fn(),
    createClaim: vi.fn(),
    updateClaim: vi.fn(),
    listPoliciesByUser: vi.fn(),
    listPendingClaims: vi.fn(),
    listApprovedPendingPayouts: vi.fn(),
    listExpiredActivePolicies: vi.fn(),
    withTransaction: vi.fn(),
  };
}

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const USER_ID = 'user-uuid-001';
const ADMIN_ID = 'admin-uuid-001';
const TICKET_ID = 'ticket-uuid-001';
const ORDER_ID = 'order-uuid-001';
const POLICY_ID = 'policy-uuid-001';
const CLAIM_ID = 'claim-uuid-001';

const TICKET_PRICE = 500000; // 5000 CZK in halíře
const EVENT_DATE = new Date('2026-05-15');

const MOCK_POLICY: InsurancePolicy = {
  id: POLICY_ID,
  ticket_id: TICKET_ID,
  order_id: ORDER_ID,
  user_id: USER_ID,
  ticket_price: TICKET_PRICE,
  premium_amount: 12900, // tier_3 for 5000 Kč ticket
  coverage_amount: 500000, // Full ticket price
  status: 'active',
  claim_deadline: new Date('2026-06-15'),
  created_at: new Date(),
};

const MOCK_CLAIM: InsuranceClaim = {
  id: CLAIM_ID,
  policy_id: POLICY_ID,
  user_id: USER_ID,
  reason: 'cancellation',
  description: 'Event cancelled',
  evidence_url: 'https://example.com/proof.pdf',
  status: 'pending',
  submitted_at: new Date(),
  reviewed_at: null,
  reviewed_by: null,
  rejection_reason: null,
  payout_amount: null,
  payout_at: null,
};

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('InsuranceService', () => {
  let db: InsuranceDbAdapter;

  beforeEach(() => {
    db = makeMockDb();
  });

  // -------------------------------------------------------------------------
  // 1. getQuote (pure function)
  // -------------------------------------------------------------------------

  it('1. getQuote — calculates premium correctly', () => {
    const quote: InsuranceQuote = InsuranceService.getQuote(500000);

    expect(quote.premium_amount).toBe(12900); // tier_3 (1501–5000 Kč)
    expect(quote.coverage_amount).toBe(500000); // Full price
  });

  it('2. getQuote — premium matches tier for price', () => {
    const quote1 = InsuranceService.getQuote(1000000); // > 5000 Kč → tier_4
    const quote2 = InsuranceService.getQuote(500000);   // 5000 Kč → tier_3

    expect(quote1.premium_amount).toBe(24900); // tier_4
    expect(quote2.premium_amount).toBe(12900); // tier_3
  });

  // -------------------------------------------------------------------------
  // 3. purchaseInsurance
  // -------------------------------------------------------------------------

  it('3. purchaseInsurance — creates policy', async () => {
    vi.mocked(db.findPolicyByTicket).mockResolvedValue(null);
    vi.mocked(db.createPolicy).mockResolvedValue(MOCK_POLICY);

    const result = await InsuranceService.purchaseInsurance(
      TICKET_ID,
      ORDER_ID,
      USER_ID,
      TICKET_PRICE,
      EVENT_DATE,
      db
    );

    expect(result.id).toBe(POLICY_ID);
    expect(result.status).toBe('active');
    expect(result.ticket_price).toBe(TICKET_PRICE);
    expect(result.premium_amount).toBe(12900); // tier_3 for 5000 Kč
    expect(result.coverage_amount).toBe(TICKET_PRICE);
    expect(vi.mocked(db.createPolicy)).toHaveBeenCalledOnce();
  });

  it('4. purchaseInsurance — policy already exists throws', async () => {
    vi.mocked(db.findPolicyByTicket).mockResolvedValue(MOCK_POLICY);

    await expect(
      InsuranceService.purchaseInsurance(
        TICKET_ID,
        ORDER_ID,
        USER_ID,
        TICKET_PRICE,
        EVENT_DATE,
        db
      )
    ).rejects.toThrow(InsuranceAlreadyClaimedError);
  });

  // -------------------------------------------------------------------------
  // 5. submitClaim
  // -------------------------------------------------------------------------

  it('5. submitClaim — creates pending claim', async () => {
    vi.mocked(db.findPolicy).mockResolvedValue(MOCK_POLICY);
    vi.mocked(db.findClaimByPolicy).mockResolvedValue(null);
    vi.mocked(db.withTransaction).mockImplementation(async (fn) => fn(null));
    vi.mocked(db.createClaim).mockResolvedValue(MOCK_CLAIM);
    vi.mocked(db.updatePolicyStatus).mockResolvedValue(undefined);

    const result = await InsuranceService.submitClaim(
      POLICY_ID,
      USER_ID,
      {
        reason: 'cancellation',
        description: 'Event cancelled',
        evidenceUrl: 'https://example.com/proof.pdf',
      },
      db
    );

    expect(result.id).toBe(CLAIM_ID);
    expect(result.status).toBe('pending');
    expect(result.user_id).toBe(USER_ID);
    expect(vi.mocked(db.updatePolicyStatus)).toHaveBeenCalledWith(POLICY_ID, 'claimed', null);
  });

  it('6. submitClaim — wrong user throws unauthorized', async () => {
    vi.mocked(db.findPolicy).mockResolvedValue(MOCK_POLICY);

    await expect(
      InsuranceService.submitClaim(
        POLICY_ID,
        'other-user',
        { reason: 'cancellation', description: 'Event cancelled' },
        db
      )
    ).rejects.toThrow(InsuranceUnauthorizedError);
  });

  it('7. submitClaim — past deadline throws', async () => {
    const expiredPolicy = { ...MOCK_POLICY, claim_deadline: new Date('2026-04-01') };
    vi.mocked(db.findPolicy).mockResolvedValue(expiredPolicy);

    await expect(
      InsuranceService.submitClaim(
        POLICY_ID,
        USER_ID,
        { reason: 'cancellation', description: 'Event cancelled' },
        db
      )
    ).rejects.toThrow(InsuranceClaimDeadlinePassedError);
  });

  it('8. submitClaim — duplicate claim throws', async () => {
    vi.mocked(db.findPolicy).mockResolvedValue(MOCK_POLICY);
    vi.mocked(db.findClaimByPolicy).mockResolvedValue(MOCK_CLAIM);

    await expect(
      InsuranceService.submitClaim(
        POLICY_ID,
        USER_ID,
        { reason: 'cancellation', description: 'Event cancelled' },
        db
      )
    ).rejects.toThrow(InsuranceAlreadyClaimedError);
  });

  // -------------------------------------------------------------------------
  // 9. approveClaim
  // -------------------------------------------------------------------------

  it('9. approveClaim — approves and sets payout', async () => {
    const approved = { ...MOCK_CLAIM, status: 'approved' as const, reviewed_by: ADMIN_ID, reviewed_at: new Date(), payout_amount: MOCK_POLICY.coverage_amount };
    vi.mocked(db.findClaim).mockResolvedValue(MOCK_CLAIM);
    vi.mocked(db.findPolicy).mockResolvedValue(MOCK_POLICY);
    vi.mocked(db.withTransaction).mockImplementation(async (fn) => fn(null));
    vi.mocked(db.updateClaim).mockResolvedValue(approved);
    vi.mocked(db.updatePolicyStatus).mockResolvedValue(undefined);

    const result = await InsuranceService.approveClaim(CLAIM_ID, ADMIN_ID, db);

    expect(result.status).toBe('approved');
    expect(result.payout_amount).toBe(MOCK_POLICY.coverage_amount);
    expect(result.reviewed_by).toBe(ADMIN_ID);
    expect(vi.mocked(db.updatePolicyStatus)).toHaveBeenCalledWith(POLICY_ID, 'paid_out', null);
  });

  it('10. approveClaim — claim not found throws', async () => {
    vi.mocked(db.findClaim).mockResolvedValue(null);

    await expect(
      InsuranceService.approveClaim(CLAIM_ID, ADMIN_ID, db)
    ).rejects.toThrow(InsuranceClaimNotFoundError);
  });

  // -------------------------------------------------------------------------
  // 11. rejectClaim
  // -------------------------------------------------------------------------

  it('11. rejectClaim — rejects with reason', async () => {
    const rejected = { ...MOCK_CLAIM, status: 'rejected' as const, reviewed_by: ADMIN_ID, reviewed_at: new Date(), rejection_reason: 'Insufficient evidence' };
    vi.mocked(db.findClaim).mockResolvedValue(MOCK_CLAIM);
    vi.mocked(db.findPolicy).mockResolvedValue(MOCK_POLICY);
    vi.mocked(db.withTransaction).mockImplementation(async (fn) => fn(null));
    vi.mocked(db.updateClaim).mockResolvedValue(rejected);
    vi.mocked(db.updatePolicyStatus).mockResolvedValue(undefined);

    const result = await InsuranceService.rejectClaim(CLAIM_ID, ADMIN_ID, 'Insufficient evidence', db);

    expect(result.status).toBe('rejected');
    expect(result.rejection_reason).toBe('Insufficient evidence');
    expect(vi.mocked(db.updatePolicyStatus)).toHaveBeenCalledWith(POLICY_ID, 'rejected', null);
  });

  // -------------------------------------------------------------------------
  // 12. cancelPolicy
  // -------------------------------------------------------------------------

  it('12. cancelPolicy — user can cancel active policy', async () => {
    vi.mocked(db.findPolicy).mockResolvedValue(MOCK_POLICY);
    vi.mocked(db.updatePolicyStatus).mockResolvedValue(undefined);

    await InsuranceService.cancelPolicy(POLICY_ID, USER_ID, db);

    expect(vi.mocked(db.updatePolicyStatus)).toHaveBeenCalledWith(POLICY_ID, 'cancelled');
  });

  it('13. cancelPolicy — wrong user throws unauthorized', async () => {
    vi.mocked(db.findPolicy).mockResolvedValue(MOCK_POLICY);

    await expect(
      InsuranceService.cancelPolicy(POLICY_ID, 'other-user', db)
    ).rejects.toThrow(InsuranceUnauthorizedError);
  });

  it('14. cancelPolicy — cannot cancel non-active policy', async () => {
    const claimed = { ...MOCK_POLICY, status: 'claimed' as const };
    vi.mocked(db.findPolicy).mockResolvedValue(claimed);

    await expect(
      InsuranceService.cancelPolicy(POLICY_ID, USER_ID, db)
    ).rejects.toThrow(InsuranceInvalidStatusError);
  });

  // -------------------------------------------------------------------------
  // 15. listUserPolicies
  // -------------------------------------------------------------------------

  it('15. listUserPolicies — returns user policies', async () => {
    const policy2 = { ...MOCK_POLICY, id: 'policy-uuid-002' };
    vi.mocked(db.listPoliciesByUser).mockResolvedValue([MOCK_POLICY, policy2]);

    const result = await InsuranceService.listUserPolicies(USER_ID, db);

    expect(result).toHaveLength(2);
    expect(result[0].user_id).toBe(USER_ID);
    expect(result[1].user_id).toBe(USER_ID);
  });

  // -------------------------------------------------------------------------
  // 16. listPendingClaims (admin)
  // -------------------------------------------------------------------------

  it('16. listPendingClaims — returns pending + under_review claims', async () => {
    const claim2 = { ...MOCK_CLAIM, id: 'claim-uuid-002' };
    vi.mocked(db.listPendingClaims).mockResolvedValue([MOCK_CLAIM, claim2]);

    const result = await InsuranceService.listPendingClaims(ADMIN_ID, db);

    expect(result).toHaveLength(2);
    expect(result[0].status).toBe('pending');
  });

  // -------------------------------------------------------------------------
  // 17. Integration: Full flow
  // -------------------------------------------------------------------------

  it('17. Full flow: purchase → submit claim → approve → payout', async () => {
    // Purchase
    vi.mocked(db.findPolicyByTicket).mockResolvedValue(null);
    vi.mocked(db.createPolicy).mockResolvedValue(MOCK_POLICY);

    const policy = await InsuranceService.purchaseInsurance(
      TICKET_ID,
      ORDER_ID,
      USER_ID,
      TICKET_PRICE,
      EVENT_DATE,
      db
    );
    expect(policy.status).toBe('active');

    // Submit claim
    vi.mocked(db.findPolicy).mockResolvedValue(MOCK_POLICY);
    vi.mocked(db.findClaimByPolicy).mockResolvedValue(null);
    vi.mocked(db.withTransaction).mockImplementation(async (fn) => fn(null));
    vi.mocked(db.createClaim).mockResolvedValue(MOCK_CLAIM);
    vi.mocked(db.updatePolicyStatus).mockResolvedValue(undefined);

    const claim = await InsuranceService.submitClaim(
      POLICY_ID,
      USER_ID,
      { reason: 'cancellation', description: 'Event cancelled' },
      db
    );
    expect(claim.status).toBe('pending');

    // Approve claim
    const approved = { ...MOCK_CLAIM, status: 'approved' as const, reviewed_by: ADMIN_ID, reviewed_at: new Date(), payout_amount: MOCK_POLICY.coverage_amount };
    vi.mocked(db.findClaim).mockResolvedValue(MOCK_CLAIM);
    vi.mocked(db.findPolicy).mockResolvedValue(MOCK_POLICY);
    vi.mocked(db.updateClaim).mockResolvedValue(approved);

    const approved_claim = await InsuranceService.approveClaim(CLAIM_ID, ADMIN_ID, db);
    expect(approved_claim.status).toBe('approved');
    expect(approved_claim.payout_amount).toBe(TICKET_PRICE);
  });

  // -------------------------------------------------------------------------
  // 18. Premium calculation (integer halíře)
  // -------------------------------------------------------------------------

  it('18. getQuote — premium is always integer halíře (no decimals)', () => {
    const oddPrice = 333333; // Odd number — tier_3 (150100–500000 h)
    const quote = InsuranceService.getQuote(oddPrice);

    expect(quote.premium_amount).toBe(12900); // tier_3 fixed premium
    expect(Number.isInteger(quote.premium_amount)).toBe(true);
  });

  // -------------------------------------------------------------------------
  // 19. Policy lookup
  // -------------------------------------------------------------------------

  it('19. purchaseInsurance — policy lookup by ticket', async () => {
    vi.mocked(db.findPolicyByTicket).mockResolvedValue(null);
    vi.mocked(db.createPolicy).mockResolvedValue(MOCK_POLICY);

    await InsuranceService.purchaseInsurance(
      TICKET_ID,
      ORDER_ID,
      USER_ID,
      TICKET_PRICE,
      EVENT_DATE,
      db
    );

    expect(vi.mocked(db.findPolicyByTicket)).toHaveBeenCalledWith(TICKET_ID);
  });

  // -------------------------------------------------------------------------
  // 20. processClaimPayout — happy path
  // -------------------------------------------------------------------------

  it('20. processClaimPayout — sets payout_at for approved claim', async () => {
    const approvedClaim: InsuranceClaim = {
      ...MOCK_CLAIM,
      status: 'approved',
      payout_amount: 500000,
      payout_at: null,
    };
    vi.mocked(db.findClaim).mockResolvedValue(approvedClaim);
    vi.mocked(db.updateClaim).mockImplementation(async (_id, data) => ({
      ...approvedClaim,
      ...(data as Partial<InsuranceClaim>),
    }));

    const result = await InsuranceService.processClaimPayout(CLAIM_ID, ADMIN_ID, db);

    expect(result.payout_at).toBeInstanceOf(Date);
    expect(vi.mocked(db.updateClaim)).toHaveBeenCalledWith(
      CLAIM_ID,
      expect.objectContaining({ payout_at: expect.any(Date) }),
    );
  });

  it('21. processClaimPayout — rejects non-approved claim', async () => {
    vi.mocked(db.findClaim).mockResolvedValue({ ...MOCK_CLAIM, status: 'pending' });
    await expect(
      InsuranceService.processClaimPayout(CLAIM_ID, ADMIN_ID, db),
    ).rejects.toThrow(/not approved/);
  });

  it('22. processClaimPayout — idempotent when payout_at already set', async () => {
    const paidClaim: InsuranceClaim = {
      ...MOCK_CLAIM,
      status: 'approved',
      payout_amount: 500000,
      payout_at: new Date('2026-04-01'),
    };
    vi.mocked(db.findClaim).mockResolvedValue(paidClaim);
    const result = await InsuranceService.processClaimPayout(CLAIM_ID, ADMIN_ID, db);
    expect(result).toBe(paidClaim);
    expect(vi.mocked(db.updateClaim)).not.toHaveBeenCalled();
  });

  it('23. processClaimPayout — throws when claim not found', async () => {
    vi.mocked(db.findClaim).mockResolvedValue(null);
    await expect(
      InsuranceService.processClaimPayout(CLAIM_ID, ADMIN_ID, db),
    ).rejects.toThrow(InsuranceClaimNotFoundError);
  });

  // -------------------------------------------------------------------------
  // processPendingPayouts — batch cron
  // -------------------------------------------------------------------------

  it('24. processPendingPayouts — iterates approved claims', async () => {
    const claim1 = { ...MOCK_CLAIM, id: 'c1', status: 'approved' as const, payout_amount: 100000, payout_at: null };
    const claim2 = { ...MOCK_CLAIM, id: 'c2', status: 'approved' as const, payout_amount: 200000, payout_at: null };
    vi.mocked(db.listApprovedPendingPayouts).mockResolvedValue([claim1, claim2]);
    vi.mocked(db.findClaim).mockImplementation(async (id) =>
      id === 'c1' ? claim1 : claim2,
    );
    vi.mocked(db.updateClaim).mockImplementation(async (id, data) => ({
      ...(id === 'c1' ? claim1 : claim2),
      ...(data as Partial<InsuranceClaim>),
    }));

    const result = await InsuranceService.processPendingPayouts(ADMIN_ID, db);

    expect(result.processed).toBe(2);
    expect(result.claims).toHaveLength(2);
  });

  // -------------------------------------------------------------------------
  // expireStalePolicies
  // -------------------------------------------------------------------------

  it('25. expireStalePolicies — transitions stale active policies to expired', async () => {
    const stale1 = { ...MOCK_POLICY, id: 'p1' };
    const stale2 = { ...MOCK_POLICY, id: 'p2' };
    vi.mocked(db.listExpiredActivePolicies).mockResolvedValue([stale1, stale2]);

    const result = await InsuranceService.expireStalePolicies(db);

    expect(result.expired).toBe(2);
    expect(vi.mocked(db.updatePolicyStatus)).toHaveBeenCalledWith('p1', 'expired');
    expect(vi.mocked(db.updatePolicyStatus)).toHaveBeenCalledWith('p2', 'expired');
  });
});
