import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  generateMonthlyInvoice,
  listInvoices,
  getInvoice,
  updateInvoice,
  getPeriodFeeSummary,
  listAllInvoices,
  markInvoicePaidFromBankTx,
  markOverdueInvoices,
  voidInvoice,
} from '../services/invoice.service.js';
import { BillingError } from '../lib/billing-errors.js';
import type { BillingDB } from '../services/invoice.service.js';

// ---------------------------------------------------------------------------
// Mock DB factory
// ---------------------------------------------------------------------------

function makeDb(responses: unknown[][] = []): BillingDB {
  let i = 0;
  const db: any = {
    query: vi.fn(async () => responses[i++] ?? []),
    execute: vi.fn(async () => {}),
    transaction: vi.fn(async (fn: any) => fn(db)),
  };
  return db;
}

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const PROMOTER = 'promo-0001';
const INVOICE_ID = 'inv-0001';
const NOW = '2026-04-10T10:00:00.000Z';

const baseInvoiceRow = {
  id: INVOICE_ID,
  promoter_id: PROMOTER,
  invoice_number: 'INV-2026-04-0001',
  period_from: '2026-04-01',
  period_to: '2026-04-30',
  gross_revenue_halire: 500000,
  platform_fees_halire: 50000,
  vat_halire: 10500,
  total_halire: 60500,
  status: 'draft',
  due_date: '2026-05-14',
  paid_at: null,
  notes: null,
  created_at: NOW,
  updated_at: NOW,
};

const baseLineItem = {
  id: 'li-0001',
  invoice_id: INVOICE_ID,
  description: 'Poplatky platformy za 2026-04',
  quantity: 1,
  unit_price_halire: 50000,
  total_halire: 50000,
  created_at: NOW,
};

// ---------------------------------------------------------------------------
// generateMonthlyInvoice
// ---------------------------------------------------------------------------

describe('generateMonthlyInvoice', () => {
  it('creates a draft invoice with correct amounts', async () => {
    const db = makeDb([
      [],                                        // check duplicate → empty
      [{ gross_revenue: '500000', platform_fees: '50000', payout_count: '3' }], // fee summary
      [{ nextval: '1' }],                        // sequence
      [baseInvoiceRow],                          // INSERT invoice
      [baseLineItem],                            // INSERT line item 1 (fees)
      [{ ...baseLineItem, id: 'li-0002', description: 'DPH 21%', unit_price_halire: 10500, total_halire: 10500 }], // INSERT line item 2 (VAT)
    ]);

    const result = await generateMonthlyInvoice(
      { promoterId: PROMOTER, period: '2026-04' },
      db,
    );

    expect(result.invoiceNumber).toBe('INV-2026-04-0001');
    expect(result.status).toBe('draft');
    expect(result.platformFeesHalire).toBe(50000);
    expect(result.vatHalire).toBe(10500);
    expect(result.totalHalire).toBe(60500);
    expect(result.lineItems.length).toBeGreaterThanOrEqual(1);
  });

  it('throws INVOICE_ALREADY_EXISTS when duplicate', async () => {
    const db = makeDb([[{ id: INVOICE_ID }]]); // duplicate check returns existing

    await expect(
      generateMonthlyInvoice({ promoterId: PROMOTER, period: '2026-04' }, db),
    ).rejects.toMatchObject({ code: 'INVOICE_ALREADY_EXISTS' });
  });

  it('throws INVOICE_INVALID_PERIOD for malformed period', async () => {
    const db = makeDb();

    await expect(
      generateMonthlyInvoice({ promoterId: PROMOTER, period: '04-2026' }, db),
    ).rejects.toMatchObject({ code: 'INVOICE_INVALID_PERIOD' });

    await expect(
      generateMonthlyInvoice({ promoterId: PROMOTER, period: '2026-13' }, db),
    ).rejects.toMatchObject({ code: 'INVOICE_INVALID_PERIOD' });
  });

  it('throws NO_FEE_DATA when no payouts in period', async () => {
    const db = makeDb([
      [],                                              // no duplicate
      [{ gross_revenue: '0', platform_fees: '0', payout_count: '0' }], // no fees
    ]);

    await expect(
      generateMonthlyInvoice({ promoterId: PROMOTER, period: '2026-04' }, db),
    ).rejects.toMatchObject({ code: 'NO_FEE_DATA' });
  });

  it('respects custom dueInDays', async () => {
    const vatLineItem = { ...baseLineItem, id: 'li-vat', description: 'DPH 21%', unit_price_halire: 4200, total_halire: 4200 };
    const db = makeDb([
      [],
      [{ gross_revenue: '200000', platform_fees: '20000', payout_count: '1' }],
      [{ nextval: '2' }],
      [{ ...baseInvoiceRow, due_date: '2026-05-30' }],
      [baseLineItem],
      [vatLineItem],
    ]);

    const result = await generateMonthlyInvoice(
      { promoterId: PROMOTER, period: '2026-04', dueInDays: 30 },
      db,
    );

    expect(result.dueDate).toBe('2026-05-30');
  });
});

// ---------------------------------------------------------------------------
// getPeriodFeeSummary
// ---------------------------------------------------------------------------

describe('getPeriodFeeSummary', () => {
  it('returns zero amounts when no payouts', async () => {
    const db = makeDb([[{ gross_revenue: '0', platform_fees: '0', payout_count: '0' }]]);
    const result = await getPeriodFeeSummary(PROMOTER, '2026-04-01', '2026-04-30', db);

    expect(result.grossRevenueHalire).toBe(0);
    expect(result.platformFeesHalire).toBe(0);
    expect(result.payoutCount).toBe(0);
  });

  it('aggregates multiple payouts', async () => {
    const db = makeDb([[{ gross_revenue: '1500000', platform_fees: '150000', payout_count: '5' }]]);
    const result = await getPeriodFeeSummary(PROMOTER, '2026-04-01', '2026-04-30', db);

    expect(result.grossRevenueHalire).toBe(1_500_000);
    expect(result.platformFeesHalire).toBe(150_000);
    expect(result.payoutCount).toBe(5);
  });
});

// ---------------------------------------------------------------------------
// listInvoices
// ---------------------------------------------------------------------------

describe('listInvoices', () => {
  it('returns invoices for promoter', async () => {
    const db = makeDb([[baseInvoiceRow]]);
    const result = await listInvoices(PROMOTER, {}, db);

    expect(result).toHaveLength(1);
    expect(result[0].promoterId).toBe(PROMOTER);
  });

  it('filters by status and year', async () => {
    const db = makeDb([[baseInvoiceRow]]);
    const result = await listInvoices(PROMOTER, { status: 'draft', year: 2026 }, db);

    const sql = (db as any).query.mock.calls[0][0] as string;
    expect(sql).toContain('status');
    expect(sql).toContain('YEAR');
    expect(result).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// getInvoice
// ---------------------------------------------------------------------------

describe('getInvoice', () => {
  it('returns invoice with line items', async () => {
    const db = makeDb([[baseInvoiceRow], [baseLineItem]]);
    const result = await getInvoice(INVOICE_ID, PROMOTER, db);

    expect(result.id).toBe(INVOICE_ID);
    expect(result.lineItems).toHaveLength(1);
    expect(result.lineItems[0].description).toBe('Poplatky platformy za 2026-04');
  });

  it('throws INVOICE_NOT_FOUND for wrong promoter', async () => {
    const db = makeDb([[]]); // empty result
    await expect(getInvoice(INVOICE_ID, 'wrong', db)).rejects.toMatchObject({
      code: 'INVOICE_NOT_FOUND',
    });
  });
});

// ---------------------------------------------------------------------------
// updateInvoice
// ---------------------------------------------------------------------------

describe('updateInvoice', () => {
  it('transitions draft → issued', async () => {
    const db = makeDb([
      [baseInvoiceRow],
      [{ ...baseInvoiceRow, status: 'issued' }],
    ]);

    const result = await updateInvoice(INVOICE_ID, PROMOTER, { status: 'issued' }, db);
    expect(result.status).toBe('issued');
  });

  it('transitions issued → paid with paidAt timestamp', async () => {
    const issuedRow = { ...baseInvoiceRow, status: 'issued' };
    const db = makeDb([
      [issuedRow],
      [{ ...issuedRow, status: 'paid', paid_at: NOW }],
    ]);

    const result = await updateInvoice(
      INVOICE_ID,
      PROMOTER,
      { status: 'paid', paidAt: NOW },
      db,
    );
    expect(result.status).toBe('paid');
    expect(result.paidAt).toBe(NOW);
  });

  it('throws INVOICE_INVALID_STATUS for paid → draft (not allowed)', async () => {
    const db = makeDb([[{ ...baseInvoiceRow, status: 'paid' }]]);

    await expect(
      updateInvoice(INVOICE_ID, PROMOTER, { status: 'draft' }, db),
    ).rejects.toMatchObject({ code: 'INVOICE_INVALID_STATUS' });
  });

  it('throws INVOICE_INVALID_STATUS for void → paid (not allowed)', async () => {
    const db = makeDb([[{ ...baseInvoiceRow, status: 'void' }]]);

    await expect(
      updateInvoice(INVOICE_ID, PROMOTER, { status: 'paid' }, db),
    ).rejects.toMatchObject({ code: 'INVOICE_INVALID_STATUS' });
  });

  it('returns unchanged invoice when no fields provided', async () => {
    const db = makeDb([[baseInvoiceRow]]);
    const result = await updateInvoice(INVOICE_ID, PROMOTER, {}, db);
    expect(result.status).toBe('draft');
    // No UPDATE query should have been called
    expect((db as any).query.mock.calls.length).toBe(1); // only SELECT
  });
});

// ---------------------------------------------------------------------------
// listAllInvoices (admin)
// ---------------------------------------------------------------------------

describe('listAllInvoices', () => {
  it('returns paginated results with total', async () => {
    const db = makeDb([[{ count: '2' }], [baseInvoiceRow, { ...baseInvoiceRow, id: 'inv-0002' }]]);
    const result = await listAllInvoices({ limit: 50, offset: 0 }, db);

    expect(result.total).toBe(2);
    expect(result.items).toHaveLength(2);
  });

  it('filters by status', async () => {
    const db = makeDb([[{ count: '1' }], [baseInvoiceRow]]);
    await listAllInvoices({ status: 'draft' }, db);

    const sql = (db as any).query.mock.calls[0][0] as string;
    expect(sql).toContain('status');
  });
});

// ---------------------------------------------------------------------------
// BillingError
// ---------------------------------------------------------------------------

describe('BillingError', () => {
  it('has correct HTTP status codes', () => {
    expect(new BillingError('INVOICE_NOT_FOUND').statusCode).toBe(404);
    expect(new BillingError('INVOICE_ALREADY_EXISTS').statusCode).toBe(409);
    expect(new BillingError('INVOICE_INVALID_PERIOD').statusCode).toBe(400);
    expect(new BillingError('NO_FEE_DATA').statusCode).toBe(422);
  });

  it('toHttpError returns correct shape', () => {
    const err = new BillingError('INVOICE_NOT_FOUND');
    const http = err.toHttpError();
    expect(http.error).toBe('INVOICE_NOT_FOUND');
    expect(http.statusCode).toBe(404);
    expect(typeof http.message).toBe('string');
  });
});

// ---------------------------------------------------------------------------
// markInvoicePaidFromBankTx
// ---------------------------------------------------------------------------

describe('markInvoicePaidFromBankTx', () => {
  const issuedRow = { ...baseInvoiceRow, status: 'issued' };

  it('marks matching invoice as paid', async () => {
    const db = makeDb([
      [issuedRow],                                                       // SELECT FOR UPDATE
      [{ ...issuedRow, status: 'paid', paid_at: '2026-04-10T12:00:00Z' }], // UPDATE RETURNING
    ]);
    const paid = await markInvoicePaidFromBankTx(
      'INV-2026-04-0001',
      60500,
      '2026-04-10T12:00:00Z',
      db,
    );
    expect(paid.status).toBe('paid');
    expect(paid.paidAt).toBe('2026-04-10T12:00:00Z');
  });

  it('is idempotent when invoice already paid', async () => {
    const db = makeDb([[{ ...baseInvoiceRow, status: 'paid', paid_at: '2026-04-09T10:00:00Z' }]]);
    const result = await markInvoicePaidFromBankTx('INV-2026-04-0001', 60500, '2026-04-10T12:00:00Z', db);
    expect(result.status).toBe('paid');
    // second query (UPDATE) never executed
    expect((db.query as any).mock.calls.length).toBe(1);
  });

  it('throws INVOICE_NOT_FOUND when no match', async () => {
    const db = makeDb([[]]);
    await expect(
      markInvoicePaidFromBankTx('INV-999', 60500, NOW, db),
    ).rejects.toMatchObject({ code: 'INVOICE_NOT_FOUND' });
  });

  it('throws INVOICE_AMOUNT_MISMATCH when amount differs > 1 halire', async () => {
    const db = makeDb([[issuedRow]]);
    await expect(
      markInvoicePaidFromBankTx('INV-2026-04-0001', 60000, NOW, db),
    ).rejects.toMatchObject({ code: 'INVOICE_AMOUNT_MISMATCH' });
  });

  it('tolerates ±1 halire rounding difference', async () => {
    const db = makeDb([
      [issuedRow],
      [{ ...issuedRow, status: 'paid', paid_at: NOW }],
    ]);
    const paid = await markInvoicePaidFromBankTx('INV-2026-04-0001', 60501, NOW, db);
    expect(paid.status).toBe('paid');
  });

  it('refuses to reconcile a void invoice', async () => {
    const db = makeDb([[{ ...baseInvoiceRow, status: 'void' }]]);
    await expect(
      markInvoicePaidFromBankTx('INV-2026-04-0001', 60500, NOW, db),
    ).rejects.toMatchObject({ code: 'INVOICE_INVALID_STATUS' });
  });
});

// ---------------------------------------------------------------------------
// markOverdueInvoices
// ---------------------------------------------------------------------------

describe('markOverdueInvoices', () => {
  it('promotes issued invoices past due_date to overdue', async () => {
    const overdueRow = { ...baseInvoiceRow, status: 'overdue', due_date: '2026-03-14' };
    const db = makeDb([[overdueRow, { ...overdueRow, id: 'inv-0002' }]]);
    const result = await markOverdueInvoices('2026-04-10', db);
    expect(result).toHaveLength(2);
    expect(result[0]!.status).toBe('overdue');
  });

  it('returns empty array when no invoices overdue', async () => {
    const db = makeDb([[]]);
    const result = await markOverdueInvoices('2026-04-10', db);
    expect(result).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// voidInvoice
// ---------------------------------------------------------------------------

describe('voidInvoice', () => {
  it('voids a draft invoice and appends reason to notes', async () => {
    const voided = { ...baseInvoiceRow, status: 'void', notes: '[VOID] duplicate' };
    const db = makeDb([[baseInvoiceRow], [voided]]);
    const result = await voidInvoice(INVOICE_ID, PROMOTER, 'duplicate', db);
    expect(result.status).toBe('void');
    expect(result.notes).toContain('duplicate');
  });

  it('refuses to void a paid invoice', async () => {
    const db = makeDb([[{ ...baseInvoiceRow, status: 'paid' }]]);
    await expect(
      voidInvoice(INVOICE_ID, PROMOTER, 'whatever', db),
    ).rejects.toMatchObject({ code: 'INVOICE_NOT_VOIDABLE' });
  });

  it('refuses to void an already-void invoice', async () => {
    const db = makeDb([[{ ...baseInvoiceRow, status: 'void' }]]);
    await expect(
      voidInvoice(INVOICE_ID, PROMOTER, 'dup', db),
    ).rejects.toMatchObject({ code: 'INVOICE_NOT_VOIDABLE' });
  });

  it('throws INVOICE_NOT_FOUND for unknown invoice', async () => {
    const db = makeDb([[]]);
    await expect(
      voidInvoice('unknown', PROMOTER, 'dup', db),
    ).rejects.toMatchObject({ code: 'INVOICE_NOT_FOUND' });
  });
});
