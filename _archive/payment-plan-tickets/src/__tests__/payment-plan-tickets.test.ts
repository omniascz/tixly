import { describe, it, expect, vi } from 'vitest';
import type { DbAdapter } from '../lib/types.js';
import type { PlanType } from '../lib/types.js';
import {
  setupPaymentPlan,
  initializeInstallments,
  recordInstallmentPayment,
  issueTicketAfterFirstPayment,
  markAsDefaulted,
  getInstallmentStats,
} from '../services/payment-plan-tickets.service.js';

// ─── Mock DbAdapter factory ───────────────────────────────────────────────────

function makeMockDb(overrides: Partial<DbAdapter> = {}): DbAdapter {
  return {
    query: vi.fn().mockResolvedValue([]),
    execute: vi.fn().mockResolvedValue(undefined),
    transaction: vi.fn().mockImplementation(async (fn) => fn(makeMockDb())),
    ...overrides,
  };
}

const TICKET_TYPE_ID = 'tt-uuid-1';
const PROMOTER_ID = 'prom-uuid-1';
const ORDER_ID = 'order-uuid-1';
const PLAN_ID = 'plan-uuid-1';

function makePlanRow(overrides = {}) {
  return {
    id: PLAN_ID,
    ticket_type_id: TICKET_TYPE_ID,
    promoter_id: PROMOTER_ID,
    plan_type: 'split_3',
    enabled: true,
    down_payment_percent: 33,
    issue_ticket_after: 'first_payment',
    created_at: new Date().toISOString(),
    ...overrides,
  };
}

describe('#209 Payment Plan Tickets', () => {
  // 1. setupPaymentPlan: vytvoří plan pro ticket type
  it('setupPaymentPlan: vytvoří plan pro ticket type', async () => {
    const executeMock = vi.fn().mockResolvedValue(undefined);
    const db = makeMockDb({ execute: executeMock });
    const result = await setupPaymentPlan(TICKET_TYPE_ID, PROMOTER_ID, {
      ticketTypeId: TICKET_TYPE_ID,
      promoterId: PROMOTER_ID,
      planType: 'split_3',
      enabled: true,
      downPaymentPercent: 33,
      issueTicketAfter: 'first_payment',
    }, db);
    expect(result.ticketTypeId).toBe(TICKET_TYPE_ID);
    expect(result.planType).toBe('split_3');
    expect(executeMock).toHaveBeenCalled();
  });

  // 2. setupPaymentPlan: hodí error pro downPaymentPercent > 100
  it('setupPaymentPlan: hodí error pro downPaymentPercent > 100', async () => {
    const db = makeMockDb();
    await expect(
      setupPaymentPlan(TICKET_TYPE_ID, PROMOTER_ID, {
        ticketTypeId: TICKET_TYPE_ID,
        promoterId: PROMOTER_ID,
        planType: 'split_3',
        enabled: true,
        downPaymentPercent: 150,
        issueTicketAfter: 'first_payment',
      }, db),
    ).rejects.toThrow(/100/);
  });

  // 3. initializeInstallments: split_3 → 3 splátky v harmonogramu
  it('initializeInstallments: split_3 → 3 splátky v harmonogramu', async () => {
    const db = makeMockDb({
      query: vi.fn().mockResolvedValue([makePlanRow()]),
    });
    const result = await initializeInstallments(ORDER_ID, TICKET_TYPE_ID, 10000, 'split_3', db);
    expect(result.installments).toHaveLength(3);
  });

  // 4. initializeInstallments: split_6 → 6 splátek
  it('initializeInstallments: split_6 → 6 splátek', async () => {
    const db = makeMockDb({
      query: vi.fn().mockResolvedValue([makePlanRow({ plan_type: 'split_6' })]),
    });
    const result = await initializeInstallments(ORDER_ID, TICKET_TYPE_ID, 12000, 'split_6', db);
    expect(result.installments).toHaveLength(6);
  });

  // 5. initializeInstallments: 1. splátka = downPaymentPercent (33%)
  it('initializeInstallments: 1. splátka = 33% z celkové částky', async () => {
    const db = makeMockDb({
      query: vi.fn().mockResolvedValue([makePlanRow()]),
    });
    const total = 10000;
    const result = await initializeInstallments(ORDER_ID, TICKET_TYPE_ID, total, 'split_3', db);
    const firstInstallment = result.installments[0];
    expect(firstInstallment.number).toBe(1);
    expect(firstInstallment.amountHalire).toBe(Math.round(total * 33 / 100));
  });

  // 6. initializeInstallments: součet splátek = totalAmountHalire
  it('initializeInstallments: součet splátek = totalAmountHalire', async () => {
    const db = makeMockDb({
      query: vi.fn().mockResolvedValue([makePlanRow()]),
    });
    const total = 9999;
    const result = await initializeInstallments(ORDER_ID, TICKET_TYPE_ID, total, 'split_3', db);
    const sum = result.installments.reduce((acc, i) => acc + i.amountHalire, 0);
    expect(sum).toBe(total);
  });

  // 7. initializeInstallments: first installment due NOW, ostatní +30d/60d...
  it('initializeInstallments: first installment due NOW, ostatní +30d', async () => {
    const db = makeMockDb({
      query: vi.fn().mockResolvedValue([makePlanRow()]),
    });
    const before = new Date();
    const result = await initializeInstallments(ORDER_ID, TICKET_TYPE_ID, 10000, 'split_3', db);
    const after = new Date();

    const firstDue = new Date(result.installments[0].dueAt);
    const secondDue = new Date(result.installments[1].dueAt);

    // First installment due "now"
    expect(firstDue.getTime()).toBeGreaterThanOrEqual(before.getTime() - 1000);
    expect(firstDue.getTime()).toBeLessThanOrEqual(after.getTime() + 1000);

    // Second installment is ~30 days later
    const diffDays = (secondDue.getTime() - firstDue.getTime()) / (1000 * 60 * 60 * 24);
    expect(diffDays).toBeCloseTo(30, 0);
  });

  // 8. recordInstallmentPayment: aktualizuje paidAmountHalire
  it('recordInstallmentPayment: aktualizuje paidAmountHalire', async () => {
    const schedule = [
      { number: 1, amountHalire: 3300, dueAt: new Date().toISOString(), status: 'pending' as const },
      { number: 2, amountHalire: 3350, dueAt: new Date().toISOString(), status: 'pending' as const },
      { number: 3, amountHalire: 3350, dueAt: new Date().toISOString(), status: 'pending' as const },
    ];
    const installmentRow = {
      id: 'inst-1',
      plan_id: PLAN_ID,
      order_id: ORDER_ID,
      ticket_id: null,
      plan_type: 'split_3',
      total_amount_halire: 10000,
      paid_amount_halire: 0,
      remaining_halire: 10000,
      installments: JSON.stringify(schedule),
      status: 'active',
      next_payment_at: new Date().toISOString(),
      created_at: new Date().toISOString(),
    };
    const executeMock = vi.fn().mockResolvedValue(undefined);
    const db = makeMockDb({
      query: vi.fn().mockResolvedValue([installmentRow]),
      execute: executeMock,
    });
    const result = await recordInstallmentPayment('inst-1', 1, 3300, db);
    expect(result.paidAmountHalire).toBe(3300);
    expect(executeMock).toHaveBeenCalled();
  });

  // 9. recordInstallmentPayment: splátka #1 → status='paid'
  it('recordInstallmentPayment: splátka #1 → status=paid', async () => {
    const schedule = [
      { number: 1, amountHalire: 3300, dueAt: new Date().toISOString(), status: 'pending' as const },
      { number: 2, amountHalire: 3350, dueAt: new Date().toISOString(), status: 'pending' as const },
      { number: 3, amountHalire: 3350, dueAt: new Date().toISOString(), status: 'pending' as const },
    ];
    const installmentRow = {
      id: 'inst-1',
      plan_id: PLAN_ID,
      order_id: ORDER_ID,
      ticket_id: null,
      plan_type: 'split_3',
      total_amount_halire: 10000,
      paid_amount_halire: 0,
      remaining_halire: 10000,
      installments: JSON.stringify(schedule),
      status: 'active',
      next_payment_at: new Date().toISOString(),
      created_at: new Date().toISOString(),
    };
    const db = makeMockDb({
      query: vi.fn().mockResolvedValue([installmentRow]),
    });
    const result = await recordInstallmentPayment('inst-1', 1, 3300, db);
    const firstInstallment = result.installments.find((i) => i.number === 1);
    expect(firstInstallment?.status).toBe('paid');
  });

  // 10. recordInstallmentPayment: všechny zaplaceny → status='completed'
  it('recordInstallmentPayment: všechny zaplaceny → status=completed', async () => {
    const schedule = [
      { number: 1, amountHalire: 5000, dueAt: new Date().toISOString(), status: 'paid' as const, paidAt: new Date().toISOString() },
      { number: 2, amountHalire: 5000, dueAt: new Date().toISOString(), status: 'pending' as const },
    ];
    const installmentRow = {
      id: 'inst-2',
      plan_id: PLAN_ID,
      order_id: ORDER_ID,
      ticket_id: null,
      plan_type: 'split_3',
      total_amount_halire: 10000,
      paid_amount_halire: 5000,
      remaining_halire: 5000,
      installments: JSON.stringify(schedule),
      status: 'active',
      next_payment_at: new Date().toISOString(),
      created_at: new Date().toISOString(),
    };
    const db = makeMockDb({
      query: vi.fn().mockResolvedValue([installmentRow]),
    });
    const result = await recordInstallmentPayment('inst-2', 2, 5000, db);
    expect(result.status).toBe('completed');
  });

  // 11. recordInstallmentPayment: hodí error pro nesprávnou výši platby
  it('recordInstallmentPayment: hodí error pro nesprávnou výši platby', async () => {
    const schedule = [
      { number: 1, amountHalire: 3300, dueAt: new Date().toISOString(), status: 'pending' as const },
    ];
    const installmentRow = {
      id: 'inst-3',
      plan_id: PLAN_ID,
      order_id: ORDER_ID,
      ticket_id: null,
      plan_type: 'split_3',
      total_amount_halire: 10000,
      paid_amount_halire: 0,
      remaining_halire: 10000,
      installments: JSON.stringify(schedule),
      status: 'active',
      next_payment_at: new Date().toISOString(),
      created_at: new Date().toISOString(),
    };
    const db = makeMockDb({
      query: vi.fn().mockResolvedValue([installmentRow]),
    });
    await expect(recordInstallmentPayment('inst-3', 1, 9999, db)).rejects.toThrow(/Nesprávná výše/);
  });

  // 12. issueTicketAfterFirstPayment: vrátí ticketId po první splátce
  it('issueTicketAfterFirstPayment: vrátí ticketId po první splátce', async () => {
    const installmentRow = {
      id: 'inst-4',
      plan_id: PLAN_ID,
      order_id: ORDER_ID,
      ticket_id: null,
      plan_type: 'split_3',
      total_amount_halire: 10000,
      paid_amount_halire: 3300,
      remaining_halire: 6700,
      installments: JSON.stringify([]),
      status: 'active',
      next_payment_at: new Date().toISOString(),
      created_at: new Date().toISOString(),
    };
    const planRow = makePlanRow({ issue_ticket_after: 'first_payment' });
    const db = makeMockDb({
      query: vi.fn()
        .mockResolvedValueOnce([installmentRow])
        .mockResolvedValueOnce([planRow]),
    });
    const result = await issueTicketAfterFirstPayment('inst-4', db);
    expect(result).not.toBeNull();
    expect(result?.ticketId).toBeTruthy();
  });

  // 13. issueTicketAfterFirstPayment: vrátí null pokud issueTicketAfter='full_payment'
  it('issueTicketAfterFirstPayment: vrátí null pokud issueTicketAfter=full_payment', async () => {
    const installmentRow = {
      id: 'inst-5',
      plan_id: PLAN_ID,
      order_id: ORDER_ID,
      ticket_id: null,
      plan_type: 'split_3',
      total_amount_halire: 10000,
      paid_amount_halire: 3300,
      remaining_halire: 6700,
      installments: JSON.stringify([]),
      status: 'active',
      next_payment_at: new Date().toISOString(),
      created_at: new Date().toISOString(),
    };
    const planRow = makePlanRow({ issue_ticket_after: 'full_payment' });
    const db = makeMockDb({
      query: vi.fn()
        .mockResolvedValueOnce([installmentRow])
        .mockResolvedValueOnce([planRow]),
    });
    const result = await issueTicketAfterFirstPayment('inst-5', db);
    expect(result).toBeNull();
  });

  // 14. markAsDefaulted: UPDATE status na 'defaulted'
  it('markAsDefaulted: UPDATE status na defaulted', async () => {
    const executeMock = vi.fn().mockResolvedValue(undefined);
    const db = makeMockDb({ execute: executeMock });
    await markAsDefaulted('inst-6', db);
    expect(executeMock).toHaveBeenCalledWith(
      expect.stringContaining("status = 'defaulted'"),
      ['inst-6'],
    );
  });

  // 15. getInstallmentStats: vrátí správnou strukturu
  it('getInstallmentStats: vrátí správnou strukturu', async () => {
    const db = makeMockDb({ query: vi.fn().mockResolvedValue([]) });
    const result = await getInstallmentStats(PROMOTER_ID, db);
    expect(result).toHaveProperty('activeCount');
    expect(result).toHaveProperty('completedCount');
    expect(result).toHaveProperty('defaultedCount');
    expect(result).toHaveProperty('totalOutstandingHalire');
  });

  // 16. getInstallmentStats: totalOutstandingHalire = suma remaining pro active
  it('getInstallmentStats: totalOutstandingHalire = suma remaining pro active', async () => {
    const rows = [
      { status: 'active', remaining_halire: 5000 },
      { status: 'active', remaining_halire: 3000 },
      { status: 'completed', remaining_halire: 0 },
    ];
    const db = makeMockDb({ query: vi.fn().mockResolvedValue(rows) });
    const result = await getInstallmentStats(PROMOTER_ID, db);
    expect(result.totalOutstandingHalire).toBe(8000);
    expect(result.activeCount).toBe(2);
    expect(result.completedCount).toBe(1);
  });

  // 17. initializeInstallments: remainingHalire = totalAmountHalire na začátku
  it('initializeInstallments: remainingHalire = totalAmountHalire na začátku', async () => {
    const db = makeMockDb({
      query: vi.fn().mockResolvedValue([makePlanRow()]),
    });
    const total = 15000;
    const result = await initializeInstallments(ORDER_ID, TICKET_TYPE_ID, total, 'split_3', db);
    expect(result.remainingHalire).toBe(total);
  });

  // 18. recordInstallmentPayment: remainingHalire se sníží po platbě
  it('recordInstallmentPayment: remainingHalire se sníží po platbě', async () => {
    const schedule = [
      { number: 1, amountHalire: 5000, dueAt: new Date().toISOString(), status: 'pending' as const },
      { number: 2, amountHalire: 5000, dueAt: new Date().toISOString(), status: 'pending' as const },
    ];
    const installmentRow = {
      id: 'inst-7',
      plan_id: PLAN_ID,
      order_id: ORDER_ID,
      ticket_id: null,
      plan_type: 'split_3',
      total_amount_halire: 10000,
      paid_amount_halire: 0,
      remaining_halire: 10000,
      installments: JSON.stringify(schedule),
      status: 'active',
      next_payment_at: new Date().toISOString(),
      created_at: new Date().toISOString(),
    };
    const db = makeMockDb({
      query: vi.fn().mockResolvedValue([installmentRow]),
    });
    const result = await recordInstallmentPayment('inst-7', 1, 5000, db);
    expect(result.remainingHalire).toBe(5000);
  });
});
