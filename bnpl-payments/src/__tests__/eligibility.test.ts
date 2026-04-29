import { describe, it, expect } from 'vitest';
import {
  checkEligibility,
  MAX_ACTIVE_PAYMENTS,
  MAX_AMOUNT_CZK,
  MAX_TOTAL_ACTIVE_CZK,
  MIN_AMOUNT_CZK,
} from '../lib/eligibility';
import type { BnplPayment } from '../types/bnpl.types';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makePayment(overrides: Partial<BnplPayment> = {}): BnplPayment {
  return {
    id: 'p1',
    orderId: 'o1',
    userId: 'u1',
    provider: 'twisto',
    providerPaymentId: 'pp1',
    amountCzk: 100_00,
    dueDate: new Date('2026-05-01'),
    deferralDays: 14,
    status: 'approved',
    approvedAt: new Date(),
    paidAt: null,
    failureReason: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('checkEligibility', () => {
  it('vrátí eligible=true pro uživatele bez historie a platnou částku', () => {
    const r = checkEligibility('u1', 500_00, 'twisto', []);
    expect(r.eligible).toBe(true);
    expect(r.reason).toBeNull();
    expect(r.maxAmountCzk).toBe(MAX_AMOUNT_CZK);
  });

  it('odmítne pokud má uživatel overdue platbu', () => {
    const past = [makePayment({ status: 'overdue' })];
    const r = checkEligibility('u1', 500_00, 'twisto', past);
    expect(r.eligible).toBe(false);
    expect(r.reason).toMatch(/overdue|defaulted/i);
    expect(r.maxAmountCzk).toBe(0);
  });

  it('odmítne pokud má uživatel defaulted platbu', () => {
    const past = [makePayment({ status: 'defaulted' })];
    const r = checkEligibility('u1', 500_00, 'twisto', past);
    expect(r.eligible).toBe(false);
    expect(r.maxAmountCzk).toBe(0);
  });

  it('ignoruje paid / cancelled / rejected — nemají vliv na bad standing', () => {
    const past = [
      makePayment({ id: 'a', status: 'paid' }),
      makePayment({ id: 'b', status: 'cancelled' }),
      makePayment({ id: 'c', status: 'rejected' }),
    ];
    const r = checkEligibility('u1', 500_00, 'twisto', past);
    expect(r.eligible).toBe(true);
  });

  it('odmítne pokud už má MAX_ACTIVE_PAYMENTS aktivních/approved plateb', () => {
    const past = Array.from({ length: MAX_ACTIVE_PAYMENTS }, (_, i) =>
      makePayment({ id: `p${i}`, amountCzk: 1000_00, status: 'active' }),
    );
    const r = checkEligibility('u1', 500_00, 'twisto', past);
    expect(r.eligible).toBe(false);
    expect(r.reason).toMatch(/maximum number/i);
  });

  it('povolí když má méně než MAX_ACTIVE_PAYMENTS', () => {
    const past = [
      makePayment({ id: 'a', amountCzk: 1000_00, status: 'active' }),
      makePayment({ id: 'b', amountCzk: 1000_00, status: 'approved' }),
    ];
    const r = checkEligibility('u1', 500_00, 'twisto', past);
    expect(r.eligible).toBe(true);
  });

  it('odmítne když celková aktivní expozice dosáhne stropu', () => {
    // Dvě aktivní platby o celkem MAX_TOTAL_ACTIVE_CZK.
    const past = [
      makePayment({ id: 'a', amountCzk: MAX_TOTAL_ACTIVE_CZK / 2, status: 'active' }),
      makePayment({ id: 'b', amountCzk: MAX_TOTAL_ACTIVE_CZK / 2, status: 'approved' }),
    ];
    const r = checkEligibility('u1', 500_00, 'twisto', past);
    expect(r.eligible).toBe(false);
    expect(r.reason).toMatch(/total BNPL exposure/i);
    expect(r.maxAmountCzk).toBe(0);
  });

  it('odmítne pokud amount je pod minimem', () => {
    const r = checkEligibility('u1', MIN_AMOUNT_CZK - 1, 'twisto', []);
    expect(r.eligible).toBe(false);
    expect(r.reason).toMatch(/minimum/i);
  });

  it('odmítne pokud amount je nad maximem', () => {
    const r = checkEligibility('u1', MAX_AMOUNT_CZK + 1, 'twisto', []);
    expect(r.eligible).toBe(false);
    expect(r.reason).toMatch(/maximum/i);
  });

  it('odmítne když amount > zbývající kapacita, i když je pod MAX', () => {
    // Jedna aktivní platba o 99 000 CZK → zbývá 1 000 CZK.
    const past = [
      makePayment({ id: 'a', amountCzk: 99_000_00, status: 'active' }),
    ];
    const r = checkEligibility('u1', 5_000_00, 'twisto', past);
    expect(r.eligible).toBe(false);
    expect(r.reason).toMatch(/remaining BNPL capacity/i);
    expect(r.maxAmountCzk).toBe(1_000_00);
  });

  it('povolí když amount přesně sedí na zbývající kapacitu', () => {
    const past = [
      makePayment({ id: 'a', amountCzk: 99_000_00, status: 'active' }),
    ];
    const r = checkEligibility('u1', 1_000_00, 'twisto', past);
    expect(r.eligible).toBe(true);
  });

  it('hraniční hodnota: MIN_AMOUNT_CZK je eligible', () => {
    const r = checkEligibility('u1', MIN_AMOUNT_CZK, 'twisto', []);
    expect(r.eligible).toBe(true);
  });

  it('hraniční hodnota: MAX_AMOUNT_CZK je eligible', () => {
    const r = checkEligibility('u1', MAX_AMOUNT_CZK, 'twisto', []);
    expect(r.eligible).toBe(true);
  });

  it('bad standing má přednost před ostatními kontrolami', () => {
    const past = [
      makePayment({ id: 'bad', status: 'overdue' }),
      makePayment({ id: 'a', amountCzk: 1_000_00, status: 'active' }),
    ];
    const r = checkEligibility('u1', 500_00, 'twisto', past);
    expect(r.eligible).toBe(false);
    expect(r.reason).toMatch(/overdue|defaulted/i);
  });
});
