/**
 * Credit note service tests — full/partial credits, state transitions, VAT.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import {
  createCreditNote,
  getCreditNote,
  listCreditNotes,
  issueCreditNote,
} from '../services/credit-note.service.js';
import type { BillingDB } from '../services/credit-note.service.js';

// ---------------------------------------------------------------------------
// Mock DB
// ---------------------------------------------------------------------------

interface MockRow { [key: string]: unknown }

function createMockDb() {
  const calls: Array<{ sql: string; params: unknown[] }> = [];
  let seqCounter = 1;

  // Stored rows
  const invoices: MockRow[] = [
    {
      id: 'inv-001',
      promoter_id: 'promo-1',
      invoice_number: 'INV-2026-04-0001',
      status: 'issued',
      total_halire: 12100, // 100 Kč + 21% VAT = 121 Kč
      platform_fees_halire: 10000,
      vat_halire: 2100,
    },
    {
      id: 'inv-002',
      promoter_id: 'promo-1',
      invoice_number: 'INV-2026-03-0001',
      status: 'paid',
      total_halire: 24200,
      platform_fees_halire: 20000,
      vat_halire: 4200,
    },
    {
      id: 'inv-003',
      promoter_id: 'promo-1',
      invoice_number: 'INV-2026-02-0001',
      status: 'void',
      total_halire: 12100,
    },
  ];

  const invoiceLineItems: MockRow[] = [
    {
      id: 'li-001',
      invoice_id: 'inv-001',
      description: 'Poplatky platformy za 2026-04',
      quantity: 1,
      unit_price_halire: 10000,
      total_halire: 12100,
      vat_rate_percent: 21,
      subtotal_halire: 10000,
      vat_halire: 2100,
      created_at: '2026-04-01',
    },
    {
      id: 'li-002',
      invoice_id: 'inv-002',
      description: 'Poplatky platformy za 2026-03',
      quantity: 1,
      unit_price_halire: 20000,
      total_halire: 24200,
      vat_rate_percent: 21,
      subtotal_halire: 20000,
      vat_halire: 4200,
      created_at: '2026-03-01',
    },
  ];

  const creditNotes: MockRow[] = [];
  const creditNoteLines: MockRow[] = [];

  const db: BillingDB = {
    async query<T>(sql: string, params?: unknown[]): Promise<T[]> {
      calls.push({ sql, params: params ?? [] });

      // Invoice lookups
      if (sql.includes('FROM platform.invoices') && sql.includes('WHERE')) {
        const id = params?.[0] as string;
        const promoterId = params?.[1] as string;
        let results = invoices;
        if (id) results = results.filter(r => r.id === id);
        if (promoterId) results = results.filter(r => r.promoter_id === promoterId);
        return results as T[];
      }

      // Invoice line items
      if (sql.includes('FROM platform.invoice_line_items')) {
        const invoiceId = params?.[0] as string;
        return invoiceLineItems.filter(r => r.invoice_id === invoiceId) as T[];
      }

      // Sequence
      if (sql.includes('nextval')) {
        return [{ nextval: String(seqCounter++) }] as T[];
      }

      // Insert credit note
      if (sql.includes('INSERT INTO platform.credit_notes')) {
        const row: MockRow = {
          id: `cn-${String(creditNotes.length + 1).padStart(3, '0')}`,
          promoter_id: params?.[0],
          original_invoice_id: params?.[1],
          credit_note_number: params?.[2],
          reason: params?.[3],
          subtotal_halire: params?.[4],
          vat_halire: params?.[5],
          total_halire: params?.[6],
          status: 'draft',
          issue_date: params?.[7],
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        };
        creditNotes.push(row);
        return [row] as T[];
      }

      // Insert credit note line items
      if (sql.includes('INSERT INTO platform.credit_note_line_items')) {
        const row: MockRow = {
          id: `cnli-${String(creditNoteLines.length + 1).padStart(3, '0')}`,
          credit_note_id: params?.[0],
          description: params?.[1],
          quantity: params?.[2],
          unit_price_halire: params?.[3],
          vat_rate_percent: params?.[4],
          subtotal_halire: params?.[5],
          vat_halire: params?.[6],
          total_halire: params?.[7],
          created_at: new Date().toISOString(),
        };
        creditNoteLines.push(row);
        return [row] as T[];
      }

      // Get credit note with invoice number
      if (sql.includes('FROM platform.credit_notes cn') && sql.includes('JOIN')) {
        const cnId = params?.[0] as string;
        const cn = creditNotes.find(c => c.id === cnId);
        if (!cn) return [] as T[];
        const inv = invoices.find(i => i.id === cn.original_invoice_id);
        return [{ ...cn, original_invoice_number: inv?.invoice_number }] as T[];
      }

      // List credit notes
      if (sql.includes('FROM platform.credit_notes') && sql.includes('ORDER BY')) {
        return creditNotes as T[];
      }

      // Update credit note status
      if (sql.includes('UPDATE platform.credit_notes SET status')) {
        const cnId = params?.[0] as string;
        const cn = creditNotes.find(c => c.id === cnId);
        if (cn) cn.status = 'issued';
        return cn ? [cn] as T[] : [] as T[];
      }

      return [] as T[];
    },
    async execute(sql: string, params?: unknown[]): Promise<void> {
      calls.push({ sql, params: params ?? [] });

      // Update invoice to reversed
      if (sql.includes('UPDATE platform.invoices SET status')) {
        const id = params?.[0] as string;
        const inv = invoices.find(i => i.id === id);
        if (inv) inv.status = 'reversed';
      }
    },
    async transaction<T>(fn: (tx: BillingDB) => Promise<T>): Promise<T> {
      return fn(db);
    },
  };

  return { db, calls, invoices, creditNotes, creditNoteLines };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('createCreditNote', () => {
  it('creates full credit note for issued invoice', async () => {
    const { db, creditNotes, invoices } = createMockDb();

    const result = await createCreditNote({
      promoterId: 'promo-1',
      originalInvoiceId: 'inv-001',
      reason: 'Event cancelled',
      issueDate: '2026-04-12',
    }, db);

    expect(result.creditNoteNumber).toMatch(/^CN-2026-04-/);
    expect(result.reason).toBe('Event cancelled');
    expect(result.originalInvoiceNumber).toBe('INV-2026-04-0001');
    expect(result.lineItems).toHaveLength(1);
    expect(result.lineItems[0]!.description).toContain('Dobropis');

    // Full credit = original reversed
    const inv = invoices.find(i => i.id === 'inv-001');
    expect(inv!.status).toBe('reversed');
  });

  it('creates full credit note for paid invoice', async () => {
    const { db, invoices } = createMockDb();

    const result = await createCreditNote({
      promoterId: 'promo-1',
      originalInvoiceId: 'inv-002',
      reason: 'Refund all fees',
      issueDate: '2026-04-12',
    }, db);

    expect(result.subtotalHalire).toBe(20000);
    expect(result.vatHalire).toBe(4200);
    expect(result.totalHalire).toBe(24200);
    const inv = invoices.find(i => i.id === 'inv-002');
    expect(inv!.status).toBe('reversed');
  });

  it('rejects credit note for void invoice', async () => {
    const { db } = createMockDb();

    await expect(createCreditNote({
      promoterId: 'promo-1',
      originalInvoiceId: 'inv-003',
      reason: 'Should fail',
      issueDate: '2026-04-12',
    }, db)).rejects.toThrow('Dobropis');
  });

  it('rejects credit note for non-existent invoice', async () => {
    const { db } = createMockDb();

    await expect(createCreditNote({
      promoterId: 'promo-1',
      originalInvoiceId: 'inv-999',
      reason: 'Not found',
      issueDate: '2026-04-12',
    }, db)).rejects.toThrow();
  });

  it('applies partial credit via lineOverrides', async () => {
    const { db, invoices } = createMockDb();

    const result = await createCreditNote({
      promoterId: 'promo-1',
      originalInvoiceId: 'inv-002',
      reason: 'Partial refund 50%',
      issueDate: '2026-04-12',
      lineIndexes: [0],
      lineOverrides: { 0: { unitPriceHalire: 10000 } }, // half of 20000
    }, db);

    // 10000 base + 2100 VAT = 12100 total (half of 24200)
    expect(result.subtotalHalire).toBe(10000);
    expect(result.totalHalire).toBe(12100);
    // Partial credit — original NOT reversed
    const inv = invoices.find(i => i.id === 'inv-002');
    expect(inv!.status).toBe('paid'); // unchanged
  });

  it('VAT is calculated per-line using the engine', async () => {
    const { db } = createMockDb();

    const result = await createCreditNote({
      promoterId: 'promo-1',
      originalInvoiceId: 'inv-001',
      reason: 'Test VAT calc',
      issueDate: '2026-04-12',
    }, db);

    // Original: 10000 base at 21% = 2100 VAT
    expect(result.vatHalire).toBe(2100);
    expect(result.lineItems[0]!.vatRatePercent).toBe(21);
    expect(result.lineItems[0]!.vatHalire).toBe(2100);
  });
});

describe('issueCreditNote', () => {
  it('transitions draft → issued', async () => {
    const { db } = createMockDb();

    // First create one
    const cn = await createCreditNote({
      promoterId: 'promo-1',
      originalInvoiceId: 'inv-001',
      reason: 'Test issue',
      issueDate: '2026-04-12',
    }, db);

    const issued = await issueCreditNote(cn.id, 'promo-1', db);
    expect(issued.status).toBe('issued');
  });
});
