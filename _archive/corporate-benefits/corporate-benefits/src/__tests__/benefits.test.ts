import { describe, it, expect, vi } from 'vitest';
import { createEmployer, getEmployer, listEmployers, addEmployee, getEmployee, listEmployees, deactivateEmployee } from '../services/employer.service.js';
import { createProgram, getProgram, listPrograms, allocateMonthly, listAllocations } from '../services/program.service.js';
import { getWalletBalance, spend, refund, listTransactions } from '../services/wallet.service.js';
import { getEmployerReport } from '../services/report.service.js';
import { BenefitError, isBenefitError, BENEFIT_CATEGORIES, isValidCategory } from '../lib/benefit-errors.js';

function makeDb(rows: unknown[][] = []) {
  let idx = 0;
  return {
    query: vi.fn().mockImplementation(() => Promise.resolve({ rows: rows[idx++] ?? [] })),
    execute: vi.fn().mockResolvedValue(undefined),
  };
}

const EMPLOYER = { id: 'emp1', name: 'ACME s.r.o.', ico: '12345678', billingEmail: 'billing@acme.cz', plan: 'growth' as const, contactPhone: null, isActive: true, createdAt: new Date() };
const EMPLOYEE = { id: 'e1', employerId: 'emp1', email: 'jan@acme.cz', name: 'Jan Novák', externalId: null, department: 'IT', isActive: true, joinedAt: new Date(), leftAt: null };
const PROGRAM = { id: 'p1', employerId: 'emp1', name: 'Sport', monthlyCreditHellers: 100000, allowedCategories: ['sport', 'wellness'] as const, rolloverMonths: 0, isActive: true };

// ---------------------------------------------------------------------------
// Category validation
// ---------------------------------------------------------------------------
describe('Category helpers', () => {
  it('has 8 canonical categories', () => {
    expect(BENEFIT_CATEGORIES.length).toBe(8);
    expect(BENEFIT_CATEGORIES).toContain('sport');
    expect(BENEFIT_CATEGORIES).toContain('food');
  });
  it('validates known categories', () => {
    expect(isValidCategory('sport')).toBe(true);
    expect(isValidCategory('unknown')).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Employer CRUD
// ---------------------------------------------------------------------------
describe('Employer CRUD', () => {
  it('creates an employer', async () => {
    const db = makeDb([[EMPLOYER]]);
    const r = await createEmployer({ name: 'ACME s.r.o.', ico: '12345678', billingEmail: 'billing@acme.cz', plan: 'growth' }, db);
    expect(r.plan).toBe('growth');
  });

  it('gets employer with stats', async () => {
    const db = makeDb([[{ ...EMPLOYER, employeeCount: 50, totalAllocatedHellers: 500000 }]]);
    const r = await getEmployer('emp1', db);
    expect(r.employeeCount).toBe(50);
    expect(r.totalAllocatedHellers).toBe(500000);
  });

  it('throws EMPLOYER_NOT_FOUND', async () => {
    const db = makeDb([[]]);
    await expect(getEmployer('missing', db)).rejects.toThrow(BenefitError);
  });

  it('lists active employers', async () => {
    const db = makeDb([[EMPLOYER]]);
    const r = await listEmployers(db);
    expect(r).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// Employee CRUD
// ---------------------------------------------------------------------------
describe('Employee CRUD', () => {
  it('adds an employee with lowercased email', async () => {
    const db = makeDb([[EMPLOYEE]]);
    await addEmployee({ employerId: 'emp1', email: 'Jan@ACME.CZ', name: 'Jan Novák', department: 'IT' }, db);
    const params = db.query.mock.calls[0][1] as unknown[];
    expect(params[1]).toBe('jan@acme.cz');
  });

  it('throws DUPLICATE_EMPLOYEE on unique violation', async () => {
    const db = {
      query: vi.fn().mockRejectedValue({ code: '23505' }),
      execute: vi.fn(),
    };
    await expect(addEmployee({ employerId: 'emp1', email: 'jan@acme.cz', name: 'Jan' }, db))
      .rejects.toThrow(BenefitError);
  });

  it('gets employee by id', async () => {
    const db = makeDb([[EMPLOYEE]]);
    const r = await getEmployee('e1', db);
    expect(r.name).toBe('Jan Novák');
  });

  it('throws EMPLOYEE_NOT_FOUND', async () => {
    const db = makeDb([[]]);
    await expect(getEmployee('missing', db)).rejects.toThrow(BenefitError);
  });

  it('lists active employees only when activeOnly=true', async () => {
    const db = makeDb([[EMPLOYEE]]);
    await listEmployees('emp1', true, db);
    const sql = db.query.mock.calls[0][0] as string;
    expect(sql).toContain('is_active = true');
  });

  it('deactivates an employee', async () => {
    const db = makeDb([[{ ...EMPLOYEE, isActive: false, leftAt: new Date() }]]);
    const r = await deactivateEmployee('e1', db);
    expect(r.isActive).toBe(false);
    expect(r.leftAt).toBeTruthy();
  });
});

// ---------------------------------------------------------------------------
// Program CRUD
// ---------------------------------------------------------------------------
describe('Program CRUD', () => {
  it('creates a program with valid categories', async () => {
    const db = makeDb([[PROGRAM]]);
    const r = await createProgram({
      employerId: 'emp1', name: 'Sport',
      monthlyCreditHellers: 100000,
      allowedCategories: ['sport', 'wellness'],
    }, db);
    expect(r.monthlyCreditHellers).toBe(100000);
  });

  it('rejects negative credit', async () => {
    const db = makeDb();
    await expect(createProgram({
      employerId: 'emp1', name: 'X', monthlyCreditHellers: -1, allowedCategories: ['sport'],
    }, db)).rejects.toThrow(BenefitError);
  });

  it('rejects unknown category', async () => {
    const db = makeDb();
    await expect(createProgram({
      employerId: 'emp1', name: 'X', monthlyCreditHellers: 1000, allowedCategories: ['unknown'],
    }, db)).rejects.toThrow(BenefitError);
  });

  it('gets a program', async () => {
    const db = makeDb([[PROGRAM]]);
    const r = await getProgram('p1', db);
    expect(r.allowedCategories).toContain('sport');
  });

  it('lists programs for employer', async () => {
    const db = makeDb([[PROGRAM]]);
    const r = await listPrograms('emp1', db);
    expect(r).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// Monthly allocation
// ---------------------------------------------------------------------------
describe('allocateMonthly', () => {
  it('allocates credits to all active employees', async () => {
    const db = makeDb([
      [PROGRAM],            // getProgram
      [{ id: 'e1' }, { id: 'e2' }, { id: 'e3' }], // employees without allocation
      [{ cnt: 3 }],         // total active count
    ]);
    const r = await allocateMonthly('p1', '2026-07', db);
    expect(r.allocated).toBe(3);
    expect(r.skipped).toBe(0);
    expect(r.totalHellers).toBe(300000); // 3 × 100000
    expect(db.execute).toHaveBeenCalledTimes(3);
  });

  it('skips employees who already have allocation', async () => {
    const db = makeDb([
      [PROGRAM],
      [{ id: 'e1' }],       // only 1 without allocation
      [{ cnt: 3 }],         // 3 total → 2 already had
    ]);
    const r = await allocateMonthly('p1', '2026-07', db);
    expect(r.allocated).toBe(1);
    expect(r.skipped).toBe(2);
  });

  it('throws for inactive program', async () => {
    const db = makeDb([[{ ...PROGRAM, isActive: false }]]);
    await expect(allocateMonthly('p1', '2026-07', db)).rejects.toThrow(BenefitError);
  });

  it('calculates expiry with rollover months', async () => {
    const db = makeDb([
      [{ ...PROGRAM, rolloverMonths: 2 }],
      [{ id: 'e1' }],
      [{ cnt: 1 }],
    ]);
    await allocateMonthly('p1', '2026-07', db);
    const execCall = db.execute.mock.calls[0][1] as unknown[];
    const expiresAt = execCall[4] as string;
    // Allocated in July + 2 rollover months → expires end of September
    expect(expiresAt).toContain('2026-09-30');
  });
});

describe('listAllocations', () => {
  it('returns non-expired allocations', async () => {
    const alloc = { id: 'a1', programId: 'p1', employeeId: 'e1', month: '2026-07', allocatedHellers: 100000, expiresAt: new Date(Date.now() + 30 * 86400000), programName: 'Sport', allowedCategories: ['sport', 'wellness'] };
    const db = makeDb([[alloc]]);
    const r = await listAllocations('e1', db);
    expect(r).toHaveLength(1);
    expect(r[0].programName).toBe('Sport');
  });
});

// ---------------------------------------------------------------------------
// Wallet balance
// ---------------------------------------------------------------------------
describe('getWalletBalance', () => {
  it('computes balance from active allocations', async () => {
    const db = makeDb([
      [{ is_active: true }], // employee check
      [
        { allocation_id: 'a1', program_name: 'Sport', allowed_categories: ['sport', 'wellness'],
          allocated: 100000, debited: 30000, expires_at: new Date(Date.now() + 30 * 86400000) },
        { allocation_id: 'a2', program_name: 'Food', allowed_categories: ['food'],
          allocated: 50000, debited: 0, expires_at: new Date(Date.now() + 60 * 86400000) },
      ],
    ]);
    const r = await getWalletBalance('e1', db);
    expect(r.totalHellers).toBe(120000); // 70000 + 50000
    expect(r.byAllocation).toHaveLength(2);
    expect(r.byCategory.sport).toBe(70000);
    expect(r.byCategory.wellness).toBe(70000);
    expect(r.byCategory.food).toBe(50000);
  });

  it('excludes fully consumed allocations', async () => {
    const db = makeDb([
      [{ is_active: true }],
      [
        { allocation_id: 'a1', program_name: 'Sport', allowed_categories: ['sport'],
          allocated: 100000, debited: 100000, expires_at: new Date(Date.now() + 30 * 86400000) },
      ],
    ]);
    const r = await getWalletBalance('e1', db);
    expect(r.totalHellers).toBe(0);
    expect(r.byAllocation).toHaveLength(0);
  });

  it('throws EMPLOYEE_NOT_FOUND', async () => {
    const db = makeDb([[]]);
    await expect(getWalletBalance('missing', db)).rejects.toThrow(BenefitError);
  });
});

// ---------------------------------------------------------------------------
// Spending with FIFO logic
// ---------------------------------------------------------------------------
describe('spend (FIFO by expiry)', () => {
  const TX = { id: 'tx1', employeeId: 'e1', allocationId: 'a1', type: 'debit' as const, category: 'sport' as const, amountHellers: 50000, description: 'Gym', merchantId: null, createdAt: new Date() };

  it('spends from single allocation when sufficient', async () => {
    const db = makeDb([
      [{ is_active: true }],
      [{ id: 'a1', allocated: 100000, debited: 0, expires_at: new Date(Date.now() + 30 * 86400000) }],
      [TX],
    ]);
    const r = await spend({ employeeId: 'e1', category: 'sport', amountHellers: 50000, description: 'Gym' }, db);
    expect(r).toHaveLength(1);
    expect(r[0].amountHellers).toBe(50000);
  });

  it('splits across allocations in FIFO order', async () => {
    const db = makeDb([
      [{ is_active: true }],
      // First allocation has 30000 left, expires soonest
      // Second has 100000, expires later
      [
        { id: 'a1', allocated: 50000, debited: 20000, expires_at: new Date(Date.now() + 10 * 86400000) },
        { id: 'a2', allocated: 100000, debited: 0, expires_at: new Date(Date.now() + 60 * 86400000) },
      ],
      [{ ...TX, allocationId: 'a1', amountHellers: 30000 }],
      [{ ...TX, allocationId: 'a2', amountHellers: 20000 }],
    ]);
    const r = await spend({ employeeId: 'e1', category: 'sport', amountHellers: 50000, description: 'Gym' }, db);
    expect(r).toHaveLength(2);
    // First transaction drains a1 (expires sooner)
    expect(r[0].amountHellers).toBe(30000);
    expect(r[0].allocationId).toBe('a1');
    // Second transaction takes the rest from a2
    expect(r[1].amountHellers).toBe(20000);
    expect(r[1].allocationId).toBe('a2');
  });

  it('throws INSUFFICIENT_BALANCE when total insufficient', async () => {
    const db = makeDb([
      [{ is_active: true }],
      [{ id: 'a1', allocated: 10000, debited: 0, expires_at: new Date(Date.now() + 30 * 86400000) }],
    ]);
    await expect(spend({ employeeId: 'e1', category: 'sport', amountHellers: 50000, description: 'Gym' }, db))
      .rejects.toThrow(BenefitError);
  });

  it('throws CATEGORY_NOT_ALLOWED when no eligible allocation', async () => {
    const db = makeDb([
      [{ is_active: true }],
      [], // no allocations permit this category
    ]);
    await expect(spend({ employeeId: 'e1', category: 'sport', amountHellers: 10000, description: 'Gym' }, db))
      .rejects.toThrow(BenefitError);
  });

  it('throws EMPLOYEE_INACTIVE for inactive employee', async () => {
    const db = makeDb([[{ is_active: false }]]);
    await expect(spend({ employeeId: 'e1', category: 'sport', amountHellers: 10000, description: 'Gym' }, db))
      .rejects.toThrow(BenefitError);
  });

  it('throws INVALID_AMOUNT for non-positive amount', async () => {
    const db = makeDb();
    await expect(spend({ employeeId: 'e1', category: 'sport', amountHellers: 0, description: 'Gym' }, db))
      .rejects.toThrow(BenefitError);
    await expect(spend({ employeeId: 'e1', category: 'sport', amountHellers: -100, description: 'Gym' }, db))
      .rejects.toThrow(BenefitError);
  });

  it('stores merchant_id when provided', async () => {
    const db = makeDb([
      [{ is_active: true }],
      [{ id: 'a1', allocated: 100000, debited: 0, expires_at: new Date(Date.now() + 30 * 86400000) }],
      [TX],
    ]);
    await spend({ employeeId: 'e1', category: 'sport', amountHellers: 10000, description: 'Gym', merchantId: 'm1' }, db);
    const insertParams = db.query.mock.calls[2][1] as unknown[];
    expect(insertParams[5]).toBe('m1');
  });
});

describe('refund', () => {
  it('creates a negative refund transaction', async () => {
    const db = makeDb([
      [{ employee_id: 'e1', allocation_id: 'a1', category: 'sport', amount_hellers: 50000, type: 'debit' }],
      [{ id: 'tx2', employeeId: 'e1', allocationId: 'a1', type: 'refund', category: 'sport', amountHellers: -50000, description: 'Refund: customer cancelled', merchantId: null, createdAt: new Date() }],
    ]);
    const r = await refund('tx1', 'customer cancelled', db);
    expect(r.amountHellers).toBe(-50000);
    expect(r.description).toContain('Refund');
  });

  it('rejects refunding a non-debit transaction', async () => {
    const db = makeDb([
      [{ employee_id: 'e1', allocation_id: 'a1', category: 'sport', amount_hellers: 10000, type: 'credit' }],
    ]);
    await expect(refund('tx1', 'reason', db)).rejects.toThrow(BenefitError);
  });

  it('throws when original transaction not found', async () => {
    const db = makeDb([[]]);
    await expect(refund('missing', 'reason', db)).rejects.toThrow(BenefitError);
  });
});

describe('listTransactions', () => {
  it('returns transactions with date filters', async () => {
    const tx = { id: 'tx1', employeeId: 'e1', allocationId: 'a1', type: 'debit' as const, category: 'sport' as const, amountHellers: 50000, description: 'Gym', merchantId: null, createdAt: new Date() };
    const db = makeDb([[tx]]);
    const r = await listTransactions('e1', '2026-07-01', '2026-07-31', db);
    expect(r).toHaveLength(1);
    const sql = db.query.mock.calls[0][0] as string;
    expect(sql).toContain('created_at >= $2');
    expect(sql).toContain('created_at <= $3');
  });
});

// ---------------------------------------------------------------------------
// Employer reports
// ---------------------------------------------------------------------------
describe('getEmployerReport', () => {
  it('returns aggregated report with utilization', async () => {
    const db = makeDb([
      [{ id: 'emp1' }],              // employer exists
      [{ total: 50, active: 48 }],   // employee counts
      [{ total: 4800000 }],           // allocated: 50 × 100k × 96%
      [{ total: 3600000 }],           // spent: 75%
      [
        { category: 'sport', total: 2000000 },
        { category: 'food', total: 1600000 },
      ],
      [
        { employee_id: 'e1', employee_name: 'Jan', spent: 100000 },
        { employee_id: 'e2', employee_name: 'Eva', spent: 90000 },
      ],
    ]);
    const r = await getEmployerReport('emp1', '2026-07', db);
    expect(r.totalEmployees).toBe(50);
    expect(r.activeEmployees).toBe(48);
    expect(r.totalAllocatedHellers).toBe(4800000);
    expect(r.totalSpentHellers).toBe(3600000);
    expect(r.utilizationPercent).toBe(75);
    expect(r.spendByCategory.sport).toBe(2000000);
    expect(r.topSpenders).toHaveLength(2);
    expect(r.topSpenders[0].employeeName).toBe('Jan');
  });

  it('handles zero allocation (utilization 0)', async () => {
    const db = makeDb([
      [{ id: 'emp1' }],
      [{ total: 10, active: 10 }],
      [{ total: 0 }],
      [{ total: 0 }],
      [],
      [],
    ]);
    const r = await getEmployerReport('emp1', '2026-07', db);
    expect(r.utilizationPercent).toBe(0);
  });

  it('throws EMPLOYER_NOT_FOUND', async () => {
    const db = makeDb([[]]);
    await expect(getEmployerReport('missing', '2026-07', db)).rejects.toThrow(BenefitError);
  });
});

// ---------------------------------------------------------------------------
// BenefitError
// ---------------------------------------------------------------------------
describe('BenefitError', () => {
  it('maps codes correctly', () => {
    expect(new BenefitError('INSUFFICIENT_BALANCE').statusCode).toBe(402);
    expect(new BenefitError('CATEGORY_NOT_ALLOWED').statusCode).toBe(403);
    expect(new BenefitError('DUPLICATE_EMPLOYEE').statusCode).toBe(409);
  });
  it('type guard works', () => {
    expect(isBenefitError(new BenefitError('EMPLOYER_NOT_FOUND'))).toBe(true);
    expect(isBenefitError(new Error())).toBe(false);
  });
});
