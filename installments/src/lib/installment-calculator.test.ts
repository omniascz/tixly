// Vitest unit tests for installment-calculator.ts
// Run with: vitest

import { describe, it, expect } from 'vitest';
import {
  calculateInstallmentAmounts,
  calculateDueDates,
  calculateFirstInstallmentAmount,
  isPaymentOverdue,
  shouldCancelSchedule,
  getNextPendingPayment,
} from './installment-calculator';
import type { InstallmentPlan, InstallmentPayment, InstallmentSchedule } from '../types/installment.types';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makePlan(overrides: Partial<InstallmentPlan> = {}): InstallmentPlan {
  return {
    id: 'plan-1',
    ticket_type_id: 'tt-1',
    num_installments: 2,
    interval: 'monthly',
    first_installment_pct: 50,
    active: true,
    ...overrides,
  };
}

function makePayment(overrides: Partial<InstallmentPayment> = {}): InstallmentPayment {
  return {
    id: 'pay-1',
    schedule_id: 'sched-1',
    installment_number: 1,
    amount: 10000,
    due_date: new Date('2026-05-01'),
    paid_at: null,
    gopay_payment_id: null,
    status: 'pending',
    retry_count: 0,
    last_retry_at: null,
    ...overrides,
  };
}

function makeSchedule(payments: InstallmentPayment[], overrides: Partial<InstallmentSchedule> = {}): InstallmentSchedule {
  return {
    id: 'sched-1',
    order_id: 'order-1',
    ticket_id: 'ticket-1',
    user_id: 'user-1',
    plan_id: 'plan-1',
    total_amount: 20000,
    installments: payments,
    status: 'active',
    gopay_recurrence_token: 'tok-abc',
    created_at: new Date('2026-04-01'),
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// calculateFirstInstallmentAmount
// ---------------------------------------------------------------------------

describe('calculateFirstInstallmentAmount', () => {
  it('returns 50% of total for 2-installment plan', () => {
    const plan = makePlan({ num_installments: 2, first_installment_pct: 50 });
    expect(calculateFirstInstallmentAmount(10000, plan)).toBe(5000);
  });

  it('returns floor(34% of total) for 3-installment plan', () => {
    const plan = makePlan({ num_installments: 3, first_installment_pct: 34 });
    // 10000 * 34 / 100 = 3400 exact
    expect(calculateFirstInstallmentAmount(10000, plan)).toBe(3400);
  });

  it('floors the result when division is not exact', () => {
    const plan = makePlan({ num_installments: 3, first_installment_pct: 34 });
    // 10001 * 34 / 100 = 3400.34 → floor = 3400
    expect(calculateFirstInstallmentAmount(10001, plan)).toBe(3400);
  });

  it('returns 25% of total for 4-installment plan', () => {
    const plan = makePlan({ num_installments: 4, first_installment_pct: 25 });
    expect(calculateFirstInstallmentAmount(8000, plan)).toBe(2000);
  });
});

// ---------------------------------------------------------------------------
// calculateInstallmentAmounts
// ---------------------------------------------------------------------------

describe('calculateInstallmentAmounts', () => {
  it('splits evenly into 2 installments (50/50)', () => {
    const plan = makePlan({ num_installments: 2, first_installment_pct: 50 });
    const amounts = calculateInstallmentAmounts(10000, plan);
    expect(amounts).toHaveLength(2);
    expect(amounts[0]).toBe(5000);
    expect(amounts[1]).toBe(5000);
    expect(amounts[0] + amounts[1]).toBe(10000);
  });

  it('sum of 2 installments always equals totalAmount (odd amount)', () => {
    const plan = makePlan({ num_installments: 2, first_installment_pct: 50 });
    const amounts = calculateInstallmentAmounts(10001, plan);
    expect(amounts[0] + amounts[1]).toBe(10001);
  });

  it('splits into 3 installments with correct sum', () => {
    const plan = makePlan({ num_installments: 3, first_installment_pct: 34 });
    const amounts = calculateInstallmentAmounts(10000, plan);
    expect(amounts).toHaveLength(3);
    expect(amounts.reduce((a, b) => a + b, 0)).toBe(10000);
  });

  it('haléř rounding for 3 installments — last installment absorbs remainder', () => {
    // 9999 * 34% = 3399.66 → floor = 3399; remaining = 9999 - 3399 = 6600
    // 6600 / 2 = 3300 exact, remainder = 0
    const plan = makePlan({ num_installments: 3, first_installment_pct: 34 });
    const amounts = calculateInstallmentAmounts(9999, plan);
    expect(amounts.reduce((a, b) => a + b, 0)).toBe(9999);
  });

  it('splits into 4 installments with correct sum', () => {
    const plan = makePlan({ num_installments: 4, first_installment_pct: 25 });
    const amounts = calculateInstallmentAmounts(10000, plan);
    expect(amounts).toHaveLength(4);
    expect(amounts.reduce((a, b) => a + b, 0)).toBe(10000);
  });

  it('haléř rounding for 4 installments — remainder in last payment', () => {
    // totalAmount not divisible equally
    const plan = makePlan({ num_installments: 4, first_installment_pct: 25 });
    const amounts = calculateInstallmentAmounts(10001, plan);
    expect(amounts.reduce((a, b) => a + b, 0)).toBe(10001);
    expect(amounts).toHaveLength(4);
  });

  it('first installment is always >= subsequent ones for default pcts', () => {
    const plan3 = makePlan({ num_installments: 3, first_installment_pct: 34 });
    const amounts3 = calculateInstallmentAmounts(10000, plan3);
    expect(amounts3[0]).toBeGreaterThanOrEqual(amounts3[1]);

    const plan4 = makePlan({ num_installments: 4, first_installment_pct: 25 });
    const amounts4 = calculateInstallmentAmounts(10000, plan4);
    expect(amounts4[0]).toBeGreaterThanOrEqual(amounts4[1]);
  });

  it('all amounts are integers (no decimal haléře)', () => {
    const plan = makePlan({ num_installments: 4, first_installment_pct: 25 });
    const amounts = calculateInstallmentAmounts(10007, plan);
    amounts.forEach((a) => expect(Number.isInteger(a)).toBe(true));
  });
});

// ---------------------------------------------------------------------------
// calculateDueDates
// ---------------------------------------------------------------------------

describe('calculateDueDates', () => {
  it('returns array of length equal to num_installments', () => {
    const plan = makePlan({ num_installments: 3, interval: 'monthly' });
    const dates = calculateDueDates(new Date('2026-04-04'), plan);
    expect(dates).toHaveLength(3);
  });

  it('first date equals firstPaymentDate', () => {
    const first = new Date('2026-04-04');
    const plan = makePlan({ num_installments: 2, interval: 'monthly' });
    const dates = calculateDueDates(first, plan);
    expect(dates[0]).toEqual(first);
  });

  it('weekly interval advances by 7 days each step', () => {
    const first = new Date('2026-04-04');
    const plan = makePlan({ num_installments: 3, interval: 'weekly' });
    const dates = calculateDueDates(first, plan);
    expect(dates[1].getTime() - dates[0].getTime()).toBe(7 * 24 * 60 * 60 * 1000);
    expect(dates[2].getTime() - dates[1].getTime()).toBe(7 * 24 * 60 * 60 * 1000);
  });

  it('monthly interval advances by one calendar month', () => {
    const first = new Date('2026-01-15');
    const plan = makePlan({ num_installments: 3, interval: 'monthly' });
    const dates = calculateDueDates(first, plan);
    expect(dates[1].getMonth()).toBe(1); // February
    expect(dates[1].getDate()).toBe(15);
    expect(dates[2].getMonth()).toBe(2); // March
    expect(dates[2].getDate()).toBe(15);
  });

  it('returns 4 dates for 4-installment plan (weekly)', () => {
    const plan = makePlan({ num_installments: 4, interval: 'weekly' });
    const dates = calculateDueDates(new Date('2026-04-04'), plan);
    expect(dates).toHaveLength(4);
    // last date = first + 21 days
    const expectedLast = new Date('2026-04-04');
    expectedLast.setDate(expectedLast.getDate() + 21);
    expect(dates[3]).toEqual(expectedLast);
  });
});

// ---------------------------------------------------------------------------
// isPaymentOverdue
// ---------------------------------------------------------------------------

describe('isPaymentOverdue', () => {
  const now = new Date('2026-05-10T12:00:00Z');

  it('returns true when due_date is before now and status is pending', () => {
    const payment = makePayment({ due_date: new Date('2026-05-01'), status: 'pending' });
    expect(isPaymentOverdue(payment, now)).toBe(true);
  });

  it('returns true when due_date is before now and status is retrying', () => {
    const payment = makePayment({ due_date: new Date('2026-05-01'), status: 'retrying' });
    expect(isPaymentOverdue(payment, now)).toBe(true);
  });

  it('returns false when due_date is after now', () => {
    const payment = makePayment({ due_date: new Date('2026-06-01'), status: 'pending' });
    expect(isPaymentOverdue(payment, now)).toBe(false);
  });

  it('returns false when payment is already paid', () => {
    const payment = makePayment({
      due_date: new Date('2026-05-01'),
      status: 'paid',
      paid_at: new Date('2026-05-01'),
    });
    expect(isPaymentOverdue(payment, now)).toBe(false);
  });

  it('returns false when payment is failed (terminal)', () => {
    const payment = makePayment({ due_date: new Date('2026-05-01'), status: 'failed' });
    expect(isPaymentOverdue(payment, now)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// shouldCancelSchedule
// ---------------------------------------------------------------------------

describe('shouldCancelSchedule', () => {
  it('returns true when any payment has retry_count >= 3', () => {
    const payments = [
      makePayment({ id: 'p1', installment_number: 1, status: 'paid', retry_count: 0 }),
      makePayment({ id: 'p2', installment_number: 2, status: 'retrying', retry_count: 3 }),
    ];
    expect(shouldCancelSchedule(makeSchedule(payments))).toBe(true);
  });

  it('returns false when all payments have retry_count < 3', () => {
    const payments = [
      makePayment({ id: 'p1', installment_number: 1, status: 'paid', retry_count: 0 }),
      makePayment({ id: 'p2', installment_number: 2, status: 'retrying', retry_count: 2 }),
    ];
    expect(shouldCancelSchedule(makeSchedule(payments))).toBe(false);
  });

  it('returns false for a completed schedule with no failures', () => {
    const payments = [
      makePayment({ id: 'p1', installment_number: 1, status: 'paid', retry_count: 0 }),
      makePayment({ id: 'p2', installment_number: 2, status: 'paid', retry_count: 0 }),
    ];
    expect(shouldCancelSchedule(makeSchedule(payments))).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// getNextPendingPayment
// ---------------------------------------------------------------------------

describe('getNextPendingPayment', () => {
  const now = new Date('2026-05-10T12:00:00Z');

  it('returns the earliest overdue pending payment', () => {
    const payments = [
      makePayment({ id: 'p1', installment_number: 1, status: 'paid', due_date: new Date('2026-04-01') }),
      makePayment({ id: 'p2', installment_number: 2, status: 'pending', due_date: new Date('2026-05-01') }),
      makePayment({ id: 'p3', installment_number: 3, status: 'pending', due_date: new Date('2026-06-01') }),
    ];
    const result = getNextPendingPayment(makeSchedule(payments), now);
    expect(result?.id).toBe('p2');
  });

  it('returns null when no payment is overdue', () => {
    const payments = [
      makePayment({ id: 'p1', installment_number: 1, status: 'paid', due_date: new Date('2026-04-01') }),
      makePayment({ id: 'p2', installment_number: 2, status: 'pending', due_date: new Date('2026-06-01') }),
    ];
    const result = getNextPendingPayment(makeSchedule(payments), now);
    expect(result).toBeNull();
  });

  it('returns null when all payments are paid', () => {
    const payments = [
      makePayment({ id: 'p1', installment_number: 1, status: 'paid', due_date: new Date('2026-04-01') }),
      makePayment({ id: 'p2', installment_number: 2, status: 'paid', due_date: new Date('2026-05-01') }),
    ];
    const result = getNextPendingPayment(makeSchedule(payments), now);
    expect(result).toBeNull();
  });

  it('returns retrying payment when overdue', () => {
    const payments = [
      makePayment({
        id: 'p2',
        installment_number: 2,
        status: 'retrying',
        retry_count: 1,
        due_date: new Date('2026-05-01'),
      }),
    ];
    const result = getNextPendingPayment(makeSchedule(payments), now);
    expect(result?.id).toBe('p2');
  });

  it('returns earliest by installment_number when multiple are overdue', () => {
    const payments = [
      makePayment({ id: 'p2', installment_number: 2, status: 'pending', due_date: new Date('2026-05-01') }),
      makePayment({ id: 'p3', installment_number: 3, status: 'pending', due_date: new Date('2026-05-02') }),
    ];
    const result = getNextPendingPayment(makeSchedule(payments), now);
    expect(result?.id).toBe('p2');
  });
});
