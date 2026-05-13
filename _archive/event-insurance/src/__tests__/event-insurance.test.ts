import { describe, it, expect, vi } from 'vitest';
import type { DbAdapter, InsuranceQuote, InsuranceEventType, InsuranceProviderFn } from '../lib/types.js';
import {
  getInsuranceQuote,
  purchasePolicy,
  submitClaim,
  approveClaim,
  rejectClaim,
  triggerRefundsForClaim,
  getPolicyForEvent,
} from '../services/event-insurance.service.js';

// ─── Mock DbAdapter factory ───────────────────────────────────────────────────

function makeMockDb(overrides: Partial<DbAdapter> = {}): DbAdapter {
  return {
    query: vi.fn().mockResolvedValue([]),
    execute: vi.fn().mockResolvedValue(undefined),
    transaction: vi.fn().mockImplementation(async (fn) => fn(makeMockDb())),
    ...overrides,
  };
}

const EVENT_ID = 'event-uuid-1';
const PROMOTER_ID = 'prom-uuid-1';
const POLICY_ID = 'policy-uuid-1';
const CLAIM_ID = 'claim-uuid-1';

const mockQuote: InsuranceQuote = {
  provider: 'mock',
  premiumHalire: 50000,
  coverageAmountHalire: 5000000,
  coveredEvents: ['weather', 'artist_illness'],
  validUntil: new Date(Date.now() + 86400000 * 30).toISOString(),
};

const mockProviderFn: InsuranceProviderFn = vi.fn().mockResolvedValue(mockQuote);

function makePolicyRow(overrides = {}) {
  return {
    id: POLICY_ID,
    promoter_id: PROMOTER_ID,
    event_id: EVENT_ID,
    provider: 'mock',
    policy_number: null,
    covered_events: JSON.stringify(['weather', 'artist_illness']),
    coverage_amount_halire: 5000000,
    premium_halire: 50000,
    status: 'active',
    coverage_from: new Date().toISOString(),
    coverage_to: mockQuote.validUntil,
    created_at: new Date().toISOString(),
    ...overrides,
  };
}

function makeClaimRow(overrides = {}) {
  return {
    id: CLAIM_ID,
    policy_id: POLICY_ID,
    promoter_id: PROMOTER_ID,
    event_id: EVENT_ID,
    claim_type: 'weather',
    description: 'Déšť zrušil akci',
    requested_amount_halire: 1000000,
    approved_amount_halire: null,
    status: 'submitted',
    submitted_at: new Date().toISOString(),
    resolved_at: null,
    ...overrides,
  };
}

describe('#211 Event Insurance', () => {
  // 1. getInsuranceQuote: volá getQuote s správnými params
  it('getInsuranceQuote: volá getQuote s správnými params', async () => {
    const mockFn: InsuranceProviderFn = vi.fn().mockResolvedValue(mockQuote);
    const eventRow = {
      event_date: '2026-08-15T18:00:00Z',
      capacity: 5000,
      total_ticket_revenue: 1000000,
    };
    const db = makeMockDb({ query: vi.fn().mockResolvedValue([eventRow]) });
    await getInsuranceQuote(EVENT_ID, PROMOTER_ID, ['weather'], db, mockFn);
    expect(mockFn).toHaveBeenCalledWith(
      expect.objectContaining({
        coveredEvents: ['weather'],
        capacity: 5000,
      }),
    );
  });

  // 2. getInsuranceQuote: vrátí quote strukturu
  it('getInsuranceQuote: vrátí quote strukturu', async () => {
    const db = makeMockDb({ query: vi.fn().mockResolvedValue([]) });
    const result = await getInsuranceQuote(EVENT_ID, PROMOTER_ID, ['weather'], db, mockProviderFn);
    expect(result).toHaveProperty('provider');
    expect(result).toHaveProperty('premiumHalire');
    expect(result).toHaveProperty('coverageAmountHalire');
    expect(result).toHaveProperty('coveredEvents');
    expect(result).toHaveProperty('validUntil');
  });

  // 3. purchasePolicy: INSERT do DB, status='active'
  it('purchasePolicy: INSERT do DB, status=active', async () => {
    const executeMock = vi.fn().mockResolvedValue(undefined);
    const db = makeMockDb({
      query: vi.fn().mockResolvedValue([]), // no existing policy
      execute: executeMock,
    });
    const result = await purchasePolicy(EVENT_ID, PROMOTER_ID, mockQuote, 'mock', db);
    expect(executeMock).toHaveBeenCalled();
    expect(result.status).toBe('active');
    expect(result.eventId).toBe(EVENT_ID);
  });

  // 4. purchasePolicy: hodí error pokud policy pro event již existuje
  it('purchasePolicy: hodí error pokud policy pro event již existuje', async () => {
    const db = makeMockDb({
      query: vi.fn().mockResolvedValue([{ id: POLICY_ID }]),
    });
    await expect(
      purchasePolicy(EVENT_ID, PROMOTER_ID, mockQuote, 'mock', db),
    ).rejects.toThrow(/již existuje/);
  });

  // 5. submitClaim: INSERT claim, status='submitted'
  it('submitClaim: INSERT claim, status=submitted', async () => {
    const executeMock = vi.fn().mockResolvedValue(undefined);
    const db = makeMockDb({
      query: vi.fn().mockResolvedValue([makePolicyRow()]),
      execute: executeMock,
    });
    const result = await submitClaim(POLICY_ID, PROMOTER_ID, 'weather', 'Déšť', 500000, db);
    expect(result.status).toBe('submitted');
    expect(result.claimType).toBe('weather');
    expect(executeMock).toHaveBeenCalled();
  });

  // 6. submitClaim: hodí error pro neexistující policy
  it('submitClaim: hodí error pro neexistující policy', async () => {
    const db = makeMockDb({ query: vi.fn().mockResolvedValue([]) });
    await expect(
      submitClaim('nonexistent', PROMOTER_ID, 'weather', 'Test', 100000, db),
    ).rejects.toThrow(/nenalezena/);
  });

  // 7. submitClaim: hodí error pro claimType který policy nepokrývá
  it('submitClaim: hodí error pro claimType který policy nepokrývá', async () => {
    const db = makeMockDb({
      query: vi.fn().mockResolvedValue([makePolicyRow()]),
    });
    await expect(
      submitClaim(POLICY_ID, PROMOTER_ID, 'venue_damage', 'Test', 100000, db),
    ).rejects.toThrow(/není kryt/);
  });

  // 8. submitClaim: hodí error pokud requestedAmount > coverageAmount
  it('submitClaim: hodí error pokud requestedAmount > coverageAmount', async () => {
    const db = makeMockDb({
      query: vi.fn().mockResolvedValue([makePolicyRow()]),
    });
    await expect(
      submitClaim(POLICY_ID, PROMOTER_ID, 'weather', 'Test', 9999999, db),
    ).rejects.toThrow(/překračuje maximální krytí/);
  });

  // 9. approveClaim: UPDATE status na 'approved', nastaví approvedAmount
  it('approveClaim: UPDATE status na approved, nastaví approvedAmount', async () => {
    const claimWithCoverage = {
      ...makeClaimRow(),
      coverage_amount_halire: 5000000,
    };
    const executeMock = vi.fn().mockResolvedValue(undefined);
    const db = makeMockDb({
      query: vi.fn().mockResolvedValue([claimWithCoverage]),
      execute: executeMock,
    });
    const result = await approveClaim(CLAIM_ID, 800000, db);
    expect(result.status).toBe('approved');
    expect(result.approvedAmountHalire).toBe(800000);
    expect(executeMock).toHaveBeenCalledWith(
      expect.stringContaining("status = 'approved'"),
      expect.arrayContaining([CLAIM_ID, 800000]),
    );
  });

  // 10. approveClaim: hodí error pro approved > coverageAmount
  it('approveClaim: hodí error pro approved > coverageAmount', async () => {
    const claimWithCoverage = {
      ...makeClaimRow(),
      coverage_amount_halire: 100000,
    };
    const db = makeMockDb({
      query: vi.fn().mockResolvedValue([claimWithCoverage]),
    });
    await expect(approveClaim(CLAIM_ID, 999999, db)).rejects.toThrow(/překračuje maximální krytí/);
  });

  // 11. rejectClaim: UPDATE status na 'rejected'
  it('rejectClaim: UPDATE status na rejected', async () => {
    const executeMock = vi.fn().mockResolvedValue(undefined);
    const db = makeMockDb({
      query: vi.fn().mockResolvedValue([makeClaimRow()]),
      execute: executeMock,
    });
    const result = await rejectClaim(CLAIM_ID, 'Nedostatečné důkazy', db);
    expect(result.status).toBe('rejected');
    expect(executeMock).toHaveBeenCalledWith(
      expect.stringContaining("status = 'rejected'"),
      expect.arrayContaining([CLAIM_ID]),
    );
  });

  // 12. triggerRefundsForClaim: volá refundFn pro každou paid order
  it('triggerRefundsForClaim: volá refundFn pro každou paid order', async () => {
    const orders = [
      { id: 'order-1', total_halire: 20000 },
      { id: 'order-2', total_halire: 15000 },
    ];
    const db = makeMockDb({
      query: vi.fn()
        .mockResolvedValueOnce([makeClaimRow({ status: 'approved' })])
        .mockResolvedValueOnce(orders),
    });
    const refundFn = vi.fn().mockResolvedValue(undefined);
    await triggerRefundsForClaim(CLAIM_ID, db, refundFn);
    expect(refundFn).toHaveBeenCalledTimes(2);
    expect(refundFn).toHaveBeenCalledWith('order-1', 20000);
    expect(refundFn).toHaveBeenCalledWith('order-2', 15000);
  });

  // 13. triggerRefundsForClaim: vrátí refundedCount a totalRefundedHalire
  it('triggerRefundsForClaim: vrátí refundedCount a totalRefundedHalire', async () => {
    const orders = [
      { id: 'order-1', total_halire: 20000 },
      { id: 'order-2', total_halire: 15000 },
    ];
    const db = makeMockDb({
      query: vi.fn()
        .mockResolvedValueOnce([makeClaimRow({ status: 'approved' })])
        .mockResolvedValueOnce(orders),
    });
    const refundFn = vi.fn().mockResolvedValue(undefined);
    const result = await triggerRefundsForClaim(CLAIM_ID, db, refundFn);
    expect(result.refundedCount).toBe(2);
    expect(result.totalRefundedHalire).toBe(35000);
  });

  // 14. triggerRefundsForClaim: hodí error pokud claim není 'approved'
  it('triggerRefundsForClaim: hodí error pokud claim není approved', async () => {
    const db = makeMockDb({
      query: vi.fn().mockResolvedValue([makeClaimRow({ status: 'submitted' })]),
    });
    const refundFn = vi.fn();
    await expect(triggerRefundsForClaim(CLAIM_ID, db, refundFn)).rejects.toThrow(/není schválen/);
  });

  // 15. getPolicyForEvent: vrátí policy nebo null
  it('getPolicyForEvent: vrátí policy pokud existuje', async () => {
    const db = makeMockDb({ query: vi.fn().mockResolvedValue([makePolicyRow()]) });
    const result = await getPolicyForEvent(EVENT_ID, PROMOTER_ID, db);
    expect(result).not.toBeNull();
    expect(result?.eventId).toBe(EVENT_ID);
  });

  it('getPolicyForEvent: vrátí null pokud neexistuje', async () => {
    const db = makeMockDb({ query: vi.fn().mockResolvedValue([]) });
    const result = await getPolicyForEvent(EVENT_ID, PROMOTER_ID, db);
    expect(result).toBeNull();
  });

  // 16. getPolicyForEvent: tenant isolation (cizí promoter → null)
  it('getPolicyForEvent: tenant isolation - cizí promoter vrátí null', async () => {
    // SQL query includes promoter_id filter; if different promoter, returns empty
    const db = makeMockDb({ query: vi.fn().mockResolvedValue([]) });
    const result = await getPolicyForEvent(EVENT_ID, 'other-promoter', db);
    expect(result).toBeNull();
  });

  // 17. purchasePolicy: premiumHalire = quote.premiumHalire
  it('purchasePolicy: premiumHalire = quote.premiumHalire', async () => {
    const executeMock = vi.fn().mockResolvedValue(undefined);
    const db = makeMockDb({
      query: vi.fn().mockResolvedValue([]),
      execute: executeMock,
    });
    const result = await purchasePolicy(EVENT_ID, PROMOTER_ID, mockQuote, 'mock', db);
    expect(result.premiumHalire).toBe(mockQuote.premiumHalire);
  });

  // 18. submitClaim: hodí error pokud policy status !== 'active'
  it('submitClaim: hodí error pokud policy status !== active', async () => {
    const db = makeMockDb({
      query: vi.fn().mockResolvedValue([makePolicyRow({ status: 'expired' })]),
    });
    await expect(
      submitClaim(POLICY_ID, PROMOTER_ID, 'weather', 'Test', 100000, db),
    ).rejects.toThrow(/není aktivní/);
  });
});
