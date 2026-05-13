/**
 * Credit note service — creates dobropisy (credit notes) for paid invoices.
 *
 * Ported from @acc/documents credit-notes.ts, adapted for Tixly:
 * - DbAdapter raw SQL instead of Drizzle ORM
 * - Integer haléře instead of Decimal.js
 * - Simplified for payout billing context
 *
 * Use cases:
 * - Event cancellation → full credit of platform fees
 * - Fee adjustment → partial credit
 * - Billing error correction
 */

import { BillingError } from '../lib/billing-errors.js';
import { calculateVat, type VatRateType, CZ_VAT_RATES_PERCENT } from '../lib/vat-engine.js';
import type {
  CreditNote,
  CreditNoteLineItem,
  CreditNoteWithLines,
  CreditNoteStatus,
  CreateCreditNoteInput,
  InvoiceLineItem,
} from '../types/billing.js';

// ---------------------------------------------------------------------------
// DB adapter (same interface as invoice service)
// ---------------------------------------------------------------------------

export interface BillingDB {
  query<T>(sql: string, params?: unknown[]): Promise<T[]>;
  execute(sql: string, params?: unknown[]): Promise<void>;
  transaction<T>(fn: (tx: BillingDB) => Promise<T>): Promise<T>;
}

// ---------------------------------------------------------------------------
// Row mappers
// ---------------------------------------------------------------------------

function mapCreditNoteRow(row: Record<string, unknown>): CreditNote {
  return {
    id: row.id as string,
    promoterId: row.promoter_id as string,
    originalInvoiceId: row.original_invoice_id as string,
    creditNoteNumber: row.credit_note_number as string,
    reason: row.reason as string,
    subtotalHalire: Number(row.subtotal_halire),
    vatHalire: Number(row.vat_halire),
    totalHalire: Number(row.total_halire),
    status: row.status as CreditNoteStatus,
    issueDate: String(row.issue_date).slice(0, 10),
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
  };
}

function mapCreditNoteLineRow(row: Record<string, unknown>): CreditNoteLineItem {
  return {
    id: row.id as string,
    creditNoteId: row.credit_note_id as string,
    description: row.description as string,
    quantity: Number(row.quantity),
    unitPriceHalire: Number(row.unit_price_halire),
    vatRatePercent: Number(row.vat_rate_percent),
    subtotalHalire: Number(row.subtotal_halire),
    vatHalire: Number(row.vat_halire),
    totalHalire: Number(row.total_halire),
  };
}

// ---------------------------------------------------------------------------
// Status transitions
// ---------------------------------------------------------------------------

const ALLOWED_CN_TRANSITIONS: Record<CreditNoteStatus, CreditNoteStatus[]> = {
  draft: ['issued', 'void'],
  issued: [],
  void: [],
};

// ---------------------------------------------------------------------------
// Credit note CRUD
// ---------------------------------------------------------------------------

/**
 * Create a credit note for an existing invoice.
 *
 * Rules:
 * - Original invoice must be in 'issued', 'paid', or 'overdue' status.
 * - Credit note total must not exceed the original invoice total.
 * - If full credit, original invoice transitions to 'reversed'.
 */
export async function createCreditNote(
  input: CreateCreditNoteInput,
  db: BillingDB,
): Promise<CreditNoteWithLines> {
  return db.transaction(async (tx) => {
    // Load original invoice
    const invoiceRows = await tx.query<Record<string, unknown>>(
      `SELECT * FROM platform.invoices WHERE id = $1 AND promoter_id = $2 FOR UPDATE`,
      [input.originalInvoiceId, input.promoterId],
    );
    if (invoiceRows.length === 0) throw new BillingError('INVOICE_NOT_FOUND');
    const invoice = invoiceRows[0]!;
    const invoiceStatus = invoice.status as string;
    const invoiceNumber = invoice.invoice_number as string;

    // Only creditable statuses
    if (!['issued', 'paid', 'overdue'].includes(invoiceStatus)) {
      throw new BillingError('CREDIT_NOTE_INVALID_SOURCE');
    }

    // Load original line items
    const originalLines = await tx.query<Record<string, unknown>>(
      `SELECT * FROM platform.invoice_line_items
       WHERE invoice_id = $1
       ORDER BY created_at`,
      [input.originalInvoiceId],
    );

    // Select lines to credit
    const selectedIndexes = input.lineIndexes ?? originalLines.map((_, i) => i);

    let creditSubtotal = 0;
    let creditVat = 0;

    const creditLineData: Array<{
      description: string;
      quantity: number;
      unitPriceHalire: number;
      vatRatePercent: number;
      subtotalHalire: number;
      vatHalire: number;
      totalHalire: number;
    }> = [];

    for (const idx of selectedIndexes) {
      const orig = originalLines[idx];
      if (!orig) throw new BillingError('CREDIT_NOTE_LINE_NOT_FOUND');

      const override = input.lineOverrides?.[idx];
      const quantity = override?.quantity ?? Number(orig.quantity);
      const unitPriceHalire = override?.unitPriceHalire ?? Number(orig.unit_price_halire);

      // Determine VAT rate from the original line
      // Original billing used flat 21%, but we now support per-line rates
      const vatRatePercent = Number(orig.vat_rate_percent ?? 21);
      const vatRateType: VatRateType =
        vatRatePercent >= 21 ? 'standard' :
        vatRatePercent >= 12 ? 'reduced' : 'zero';

      const lineSubtotal = quantity * unitPriceHalire;
      const vatCalc = calculateVat(lineSubtotal, vatRateType);

      creditLineData.push({
        description: `Dobropis: ${orig.description as string}`,
        quantity,
        unitPriceHalire,
        vatRatePercent,
        subtotalHalire: lineSubtotal,
        vatHalire: vatCalc.vatHalire,
        totalHalire: vatCalc.totalHalire,
      });

      creditSubtotal += lineSubtotal;
      creditVat += vatCalc.vatHalire;
    }

    const creditTotal = creditSubtotal + creditVat;

    // Check credit doesn't exceed original
    const originalTotal = Number(invoice.total_halire);
    if (creditTotal > originalTotal) {
      throw new BillingError('CREDIT_NOTE_EXCEEDS_AMOUNT');
    }

    // Generate credit note number: CN-YYYY-MM-<seq>
    const year = input.issueDate.slice(0, 4);
    const month = input.issueDate.slice(5, 7);
    const seqRows = await tx.query<{ nextval: string }>(
      `SELECT nextval('platform.credit_note_seq')::text AS nextval`,
      [],
    );
    const seq = seqRows[0]?.nextval ?? '1';
    const creditNoteNumber = `CN-${year}-${month}-${seq.padStart(4, '0')}`;

    // Insert credit note
    const cnRows = await tx.query<Record<string, unknown>>(
      `INSERT INTO platform.credit_notes
         (promoter_id, original_invoice_id, credit_note_number, reason,
          subtotal_halire, vat_halire, total_halire, status, issue_date)
       VALUES ($1, $2, $3, $4, $5, $6, $7, 'draft', $8)
       RETURNING *`,
      [
        input.promoterId,
        input.originalInvoiceId,
        creditNoteNumber,
        input.reason,
        creditSubtotal,
        creditVat,
        creditTotal,
        input.issueDate,
      ],
    );
    const creditNote = mapCreditNoteRow(cnRows[0]!);

    // Insert credit note line items
    const lineItems: CreditNoteLineItem[] = [];
    for (const line of creditLineData) {
      const liRows = await tx.query<Record<string, unknown>>(
        `INSERT INTO platform.credit_note_line_items
           (credit_note_id, description, quantity, unit_price_halire,
            vat_rate_percent, subtotal_halire, vat_halire, total_halire)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
         RETURNING *`,
        [
          creditNote.id,
          line.description,
          line.quantity,
          line.unitPriceHalire,
          line.vatRatePercent,
          line.subtotalHalire,
          line.vatHalire,
          line.totalHalire,
        ],
      );
      lineItems.push(mapCreditNoteLineRow(liRows[0]!));
    }

    // If full credit (total >= original total), reverse the original invoice
    if (creditTotal >= originalTotal) {
      await tx.execute(
        `UPDATE platform.invoices SET status = 'reversed', updated_at = NOW() WHERE id = $1`,
        [input.originalInvoiceId],
      );
    }

    return {
      ...creditNote,
      lineItems,
      originalInvoiceNumber: invoiceNumber,
    };
  });
}

/** Get a credit note with line items. */
export async function getCreditNote(
  creditNoteId: string,
  promoterId: string,
  db: BillingDB,
): Promise<CreditNoteWithLines> {
  const rows = await db.query<Record<string, unknown>>(
    `SELECT cn.*, i.invoice_number AS original_invoice_number
     FROM platform.credit_notes cn
     JOIN platform.invoices i ON i.id = cn.original_invoice_id
     WHERE cn.id = $1 AND cn.promoter_id = $2`,
    [creditNoteId, promoterId],
  );
  if (rows.length === 0) throw new BillingError('INVOICE_NOT_FOUND');

  const cn = mapCreditNoteRow(rows[0]!);
  const originalInvoiceNumber = rows[0]!.original_invoice_number as string;

  const liRows = await db.query<Record<string, unknown>>(
    `SELECT * FROM platform.credit_note_line_items WHERE credit_note_id = $1 ORDER BY created_at`,
    [creditNoteId],
  );

  return {
    ...cn,
    lineItems: liRows.map(mapCreditNoteLineRow),
    originalInvoiceNumber,
  };
}

/** List credit notes for a promoter. */
export async function listCreditNotes(
  promoterId: string,
  filters: { status?: CreditNoteStatus; year?: number },
  db: BillingDB,
): Promise<CreditNote[]> {
  const conditions: string[] = ['promoter_id = $1'];
  const params: unknown[] = [promoterId];
  let idx = 2;

  if (filters.status) { conditions.push(`status = $${idx++}`); params.push(filters.status); }
  if (filters.year) { conditions.push(`EXTRACT(YEAR FROM issue_date) = $${idx++}`); params.push(filters.year); }

  const rows = await db.query<Record<string, unknown>>(
    `SELECT * FROM platform.credit_notes
     WHERE ${conditions.join(' AND ')}
     ORDER BY issue_date DESC`,
    params,
  );
  return rows.map(mapCreditNoteRow);
}

/** Issue a credit note (draft → issued). */
export async function issueCreditNote(
  creditNoteId: string,
  promoterId: string,
  db: BillingDB,
): Promise<CreditNote> {
  const rows = await db.query<Record<string, unknown>>(
    `SELECT * FROM platform.credit_notes WHERE id = $1 AND promoter_id = $2`,
    [creditNoteId, promoterId],
  );
  if (rows.length === 0) throw new BillingError('INVOICE_NOT_FOUND');

  const current = rows[0]!.status as CreditNoteStatus;
  if (!ALLOWED_CN_TRANSITIONS[current].includes('issued')) {
    throw new BillingError('INVOICE_INVALID_STATUS');
  }

  const updated = await db.query<Record<string, unknown>>(
    `UPDATE platform.credit_notes SET status = 'issued', updated_at = NOW()
     WHERE id = $1 RETURNING *`,
    [creditNoteId],
  );
  return mapCreditNoteRow(updated[0]!);
}
