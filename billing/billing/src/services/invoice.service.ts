/**
 * Invoice service — generates and manages monthly invoices for platform fees.
 *
 * Flow:
 *   1. Admin/cron triggers generateMonthlyInvoice for a promoter+period.
 *   2. Service aggregates platform fee payouts for that period.
 *   3. An invoice (draft) is created with line items and VAT.
 *   4. Admin issues the invoice (status: draft → issued).
 *   5. Promoter pays → status: issued → paid.
 */

import { BillingError } from '../lib/billing-errors.js';
import { calculateVat, type VatRateType, CZ_VAT_RATES_PERCENT } from '../lib/vat-engine.js';
import { generateInvoicePdf, type InvoicePdfData, type InvoicePdfLine } from '../lib/invoice-pdf.js';
import { generateQrPaymentData, generateQrCodeImage, type QrPaymentInput } from '../lib/qr-payment.js';
import type {
  Invoice,
  InvoiceLineItem,
  InvoiceWithLines,
  InvoiceStatus,
  GenerateInvoiceInput,
  UpdateInvoiceInput,
  PeriodFeeSummary,
} from '../types/billing.js';

// ---------------------------------------------------------------------------
// DB adapter
// ---------------------------------------------------------------------------

export interface BillingDB {
  query<T>(sql: string, params?: unknown[]): Promise<T[]>;
  execute(sql: string, params?: unknown[]): Promise<void>;
  transaction<T>(fn: (tx: BillingDB) => Promise<T>): Promise<T>;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Default payment terms: 14 days */
const DEFAULT_DUE_DAYS = 14;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Parses "YYYY-MM" and returns [year, month] as numbers. Throws on invalid input. */
function parsePeriod(period: string): { year: number; month: number } {
  const match = /^(\d{4})-(\d{2})$/.exec(period);
  if (!match || !match[1] || !match[2]) throw new BillingError('INVOICE_INVALID_PERIOD');
  const year = parseInt(match[1], 10);
  const month = parseInt(match[2], 10);
  if (month < 1 || month > 12) throw new BillingError('INVOICE_INVALID_PERIOD');
  return { year, month };
}

/** Returns ISO date strings for the first and last day of a given YYYY-MM period. */
function periodBounds(year: number, month: number): { from: string; to: string } {
  const from = `${year}-${String(month).padStart(2, '0')}-01`;
  // Last day of month: go to first of next month and subtract 1 day
  const nextMonth = month === 12 ? 1 : month + 1;
  const nextYear = month === 12 ? year + 1 : year;
  const lastDay = new Date(Date.UTC(nextYear, nextMonth - 1, 1) - 86_400_000);
  const to = lastDay.toISOString().slice(0, 10);
  return { from, to };
}

function addDays(isoDate: string, days: number): string {
  const d = new Date(`${isoDate}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

function mapRow(row: Record<string, unknown>): Invoice {
  return {
    id: row.id as string,
    promoterId: row.promoter_id as string,
    invoiceNumber: row.invoice_number as string,
    periodFrom: String(row.period_from).slice(0, 10),
    periodTo: String(row.period_to).slice(0, 10),
    grossRevenueHalire: Number(row.gross_revenue_halire),
    platformFeesHalire: Number(row.platform_fees_halire),
    vatHalire: Number(row.vat_halire),
    totalHalire: Number(row.total_halire),
    status: row.status as InvoiceStatus,
    dueDate: String(row.due_date).slice(0, 10),
    paidAt: row.paid_at ? String(row.paid_at) : null,
    notes: row.notes as string | null,
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
  };
}

function mapLineItemRow(row: Record<string, unknown>): InvoiceLineItem {
  return {
    id: row.id as string,
    invoiceId: row.invoice_id as string,
    description: row.description as string,
    quantity: Number(row.quantity),
    unitPriceHalire: Number(row.unit_price_halire),
    totalHalire: Number(row.total_halire),
    createdAt: String(row.created_at),
  };
}

// ---------------------------------------------------------------------------
// Status transition guard
// ---------------------------------------------------------------------------

const ALLOWED_TRANSITIONS: Record<InvoiceStatus, InvoiceStatus[]> = {
  draft:    ['issued', 'void'],
  issued:   ['paid', 'overdue', 'void', 'reversed'],
  paid:     ['reversed'],
  overdue:  ['paid', 'void', 'reversed'],
  void:     [],
  reversed: [],
};

function assertStatusTransition(from: InvoiceStatus, to: InvoiceStatus): void {
  if (from === to) return;
  if (!ALLOWED_TRANSITIONS[from].includes(to)) {
    throw new BillingError(
      'INVOICE_INVALID_STATUS',
      `Přechod ze stavu '${from}' do '${to}' není povolen.`,
    );
  }
}

// ---------------------------------------------------------------------------
// Public service functions
// ---------------------------------------------------------------------------

/**
 * Aggregate platform fee data from platform.payouts for the period.
 * Returns zero amounts if no payouts exist (caller decides whether to proceed).
 */
export async function getPeriodFeeSummary(
  promoterId: string,
  periodFrom: string,
  periodTo: string,
  db: BillingDB,
): Promise<PeriodFeeSummary> {
  const rows = await db.query<{
    gross_revenue: string | null;
    platform_fees: string | null;
    payout_count: string;
  }>(
    `SELECT
       COALESCE(SUM(gross_revenue), 0) AS gross_revenue,
       COALESCE(SUM(platform_fees), 0) AS platform_fees,
       COUNT(*)::text AS payout_count
     FROM platform.payouts
     WHERE promoter_id = $1
       AND period_from >= $2
       AND period_to   <= $3
       AND status IN ('paid', 'approved')`,
    [promoterId, periodFrom, periodTo],
  );

  const row = rows[0];
  return {
    grossRevenueHalire: parseInt(row?.gross_revenue ?? '0', 10),
    platformFeesHalire: parseInt(row?.platform_fees ?? '0', 10),
    payoutCount: parseInt(row?.payout_count ?? '0', 10),
  };
}

/**
 * Generate a monthly invoice for a promoter.
 * Creates a draft invoice based on aggregated platform fees.
 * Throws INVOICE_ALREADY_EXISTS if an invoice for this period already exists.
 */
export async function generateMonthlyInvoice(
  input: GenerateInvoiceInput,
  db: BillingDB,
): Promise<InvoiceWithLines> {
  const { year, month } = parsePeriod(input.period);
  const { from: periodFrom, to: periodTo } = periodBounds(year, month);

  // Check for duplicate
  const existing = await db.query<{ id: string }>(
    `SELECT id FROM platform.invoices
     WHERE promoter_id = $1 AND period_from = $2`,
    [input.promoterId, periodFrom],
  );
  if (existing.length > 0) throw new BillingError('INVOICE_ALREADY_EXISTS');

  // Aggregate fee data from payouts
  const summary = await getPeriodFeeSummary(input.promoterId, periodFrom, periodTo, db);

  if (summary.platformFeesHalire === 0 && summary.payoutCount === 0) {
    throw new BillingError('NO_FEE_DATA');
  }

  const vatCalc = calculateVat(summary.platformFeesHalire, 'standard');
  const vatHalire = vatCalc.vatHalire;
  const totalHalire = vatCalc.totalHalire;
  const dueDate = addDays(periodTo, input.dueInDays ?? DEFAULT_DUE_DAYS);

  return db.transaction(async (tx) => {
    // Generate unique invoice number: INV-YYYY-MM-<seq>
    const seqRows = await tx.query<{ nextval: string }>(
      `SELECT nextval('platform.invoice_seq')::text AS nextval`,
      [],
    );
    const seq = seqRows[0]?.nextval ?? '1';
    const invoiceNumber = `INV-${year}-${String(month).padStart(2, '0')}-${seq.padStart(4, '0')}`;

    const rows = await tx.query<Record<string, unknown>>(
      `INSERT INTO platform.invoices
         (promoter_id, invoice_number, period_from, period_to,
          gross_revenue_halire, platform_fees_halire, vat_halire, total_halire,
          status, due_date, notes)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'draft', $9, $10)
       RETURNING *`,
      [
        input.promoterId,
        invoiceNumber,
        periodFrom,
        periodTo,
        summary.grossRevenueHalire,
        summary.platformFeesHalire,
        vatHalire,
        totalHalire,
        dueDate,
        input.notes ?? null,
      ],
    );

    const invoice = mapRow(rows[0]!);

    // Set variable symbol and tax date
    await tx.execute(
      `UPDATE platform.invoices SET variable_symbol = $1, tax_date = $2 WHERE id = $3`,
      [invoiceNumber, periodTo, invoice.id],
    );
    invoice.variable_symbol = invoiceNumber;
    invoice.tax_date = periodTo;

    // Create line item — single line with VAT calculated separately
    const lineItems: InvoiceLineItem[] = [];
    if (summary.platformFeesHalire > 0) {
      const liRows = await tx.query<Record<string, unknown>>(
        `INSERT INTO platform.invoice_line_items
           (invoice_id, description, quantity, unit_price_halire, total_halire,
            vat_rate_percent, subtotal_halire, vat_halire)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
         RETURNING *`,
        [
          invoice.id,
          `Poplatky platformy za ${input.period}`,
          1,
          summary.platformFeesHalire,
          totalHalire,
          CZ_VAT_RATES_PERCENT.standard,
          summary.platformFeesHalire,
          vatHalire,
        ],
      );
      lineItems.push(mapLineItemRow(liRows[0]!));
    }

    return { ...invoice, lineItems };
  });
}

/** List all invoices for a promoter, newest first. */
export async function listInvoices(
  promoterId: string,
  filters: { status?: InvoiceStatus; year?: number },
  db: BillingDB,
): Promise<Invoice[]> {
  const conditions: string[] = ['promoter_id = $1'];
  const params: unknown[] = [promoterId];
  let idx = 2;

  if (filters.status) {
    conditions.push(`status = $${idx++}`);
    params.push(filters.status);
  }
  if (filters.year) {
    conditions.push(`EXTRACT(YEAR FROM period_from) = $${idx++}`);
    params.push(filters.year);
  }

  const rows = await db.query<Record<string, unknown>>(
    `SELECT * FROM platform.invoices
     WHERE ${conditions.join(' AND ')}
     ORDER BY period_from DESC`,
    params,
  );
  return rows.map(mapRow);
}

/** Get a single invoice with its line items. */
export async function getInvoice(
  invoiceId: string,
  promoterId: string,
  db: BillingDB,
): Promise<InvoiceWithLines> {
  const rows = await db.query<Record<string, unknown>>(
    `SELECT * FROM platform.invoices WHERE id = $1 AND promoter_id = $2`,
    [invoiceId, promoterId],
  );
  if (rows.length === 0) throw new BillingError('INVOICE_NOT_FOUND');
  const invoice = mapRow(rows[0]!);

  const liRows = await db.query<Record<string, unknown>>(
    `SELECT * FROM platform.invoice_line_items WHERE invoice_id = $1 ORDER BY created_at`,
    [invoiceId],
  );
  const lineItems = liRows.map(mapLineItemRow);
  return { ...invoice, lineItems };
}

/** Update invoice status or notes. Validates status transitions. */
export async function updateInvoice(
  invoiceId: string,
  promoterId: string,
  input: UpdateInvoiceInput,
  db: BillingDB,
): Promise<Invoice> {
  const rows = await db.query<Record<string, unknown>>(
    `SELECT * FROM platform.invoices WHERE id = $1 AND promoter_id = $2`,
    [invoiceId, promoterId],
  );
  if (rows.length === 0) throw new BillingError('INVOICE_NOT_FOUND');
  const existing = mapRow(rows[0]!);

  if (input.status !== undefined) {
    assertStatusTransition(existing.status, input.status);
  }

  const sets: string[] = [];
  const params: unknown[] = [];
  let idx = 1;

  if (input.status !== undefined) { sets.push(`status = $${idx++}`); params.push(input.status); }
  if (input.paidAt !== undefined) { sets.push(`paid_at = $${idx++}`); params.push(input.paidAt); }
  if (input.notes !== undefined) { sets.push(`notes = $${idx++}`); params.push(input.notes); }

  if (sets.length === 0) return existing;

  sets.push(`updated_at = NOW()`);
  params.push(invoiceId, promoterId);

  const updated = await db.query<Record<string, unknown>>(
    `UPDATE platform.invoices SET ${sets.join(', ')}
     WHERE id = $${idx++} AND promoter_id = $${idx++}
     RETURNING *`,
    params,
  );
  return mapRow(updated[0]!);
}

/**
 * Bank reconciliation — mark an invoice paid when a matching bank transaction arrives.
 *
 * Matches on `invoiceNumber` (taken from the bank tx variable symbol / reference),
 * verifies the tx amount equals the invoice total (±1 haléř tolerance), and
 * transitions the invoice to `paid`. Idempotent: if already paid it returns the
 * existing row without throwing. Used by bank-reconciliation module's FIO webhook.
 */
export async function markInvoicePaidFromBankTx(
  invoiceNumber: string,
  txAmountHalire: number,
  paidAt: string,
  db: BillingDB,
): Promise<Invoice> {
  return db.transaction(async (tx) => {
    const rows = await tx.query<Record<string, unknown>>(
      `SELECT * FROM platform.invoices WHERE invoice_number = $1 FOR UPDATE`,
      [invoiceNumber],
    );
    if (rows.length === 0) throw new BillingError('INVOICE_NOT_FOUND');
    const invoice = mapRow(rows[0]!);

    if (invoice.status === 'paid') return invoice;
    if (invoice.status === 'void') {
      throw new BillingError('INVOICE_INVALID_STATUS');
    }

    if (Math.abs(txAmountHalire - invoice.totalHalire) > 1) {
      throw new BillingError('INVOICE_AMOUNT_MISMATCH');
    }

    const updated = await tx.query<Record<string, unknown>>(
      `UPDATE platform.invoices
         SET status = 'paid', paid_at = $1, updated_at = NOW()
       WHERE id = $2
       RETURNING *`,
      [paidAt, invoice.id],
    );
    return mapRow(updated[0]!);
  });
}

/**
 * Dunning pass — transition every 'issued' invoice whose due_date has passed into
 * 'overdue'. Returns the list of rows updated so the caller can trigger reminder
 * emails / Slack pings. Run daily via cron.
 */
export async function markOverdueInvoices(
  asOfDate: string,
  db: BillingDB,
): Promise<Invoice[]> {
  const updated = await db.query<Record<string, unknown>>(
    `UPDATE platform.invoices
       SET status = 'overdue', updated_at = NOW()
     WHERE status = 'issued'
       AND due_date < $1
     RETURNING *`,
    [asOfDate],
  );
  return updated.map(mapRow);
}

/**
 * Void an invoice. Only draft / issued / overdue invoices can be voided; paid
 * invoices require a credit note instead. Appends the reason to the notes field.
 */
export async function voidInvoice(
  invoiceId: string,
  promoterId: string,
  reason: string,
  db: BillingDB,
): Promise<Invoice> {
  const rows = await db.query<Record<string, unknown>>(
    `SELECT * FROM platform.invoices WHERE id = $1 AND promoter_id = $2`,
    [invoiceId, promoterId],
  );
  if (rows.length === 0) throw new BillingError('INVOICE_NOT_FOUND');
  const existing = mapRow(rows[0]!);

  if (existing.status === 'paid' || existing.status === 'void') {
    throw new BillingError('INVOICE_NOT_VOIDABLE');
  }

  const notes = existing.notes
    ? `${existing.notes}\n[VOID] ${reason}`
    : `[VOID] ${reason}`;

  const updated = await db.query<Record<string, unknown>>(
    `UPDATE platform.invoices
       SET status = 'void', notes = $1, updated_at = NOW()
     WHERE id = $2 AND promoter_id = $3
     RETURNING *`,
    [notes, invoiceId, promoterId],
  );
  return mapRow(updated[0]!);
}

// ---------------------------------------------------------------------------
// PDF generation
// ---------------------------------------------------------------------------

export interface PdfGenerationOptions {
  locale?: 'cs' | 'sk' | 'en' | 'de';
  /** Platform (seller) info */
  seller: {
    name: string;
    ico: string;
    dic?: string;
    address: string;
    bankAccount?: string;
    iban?: string;
  };
  /** Promoter (buyer) info — fetched from promoter profile */
  buyer: {
    name: string;
    ico?: string;
    dic?: string;
    address: string;
  };
  /** Include QR payment code on the invoice */
  includeQrCode?: boolean;
}

/**
 * Generate a PDF for an invoice. Returns Buffer (PNG).
 * Caller must provide seller/buyer info (not stored on the invoice itself).
 */
export async function generateInvoicePdfBuffer(
  invoiceId: string,
  promoterId: string,
  opts: PdfGenerationOptions,
  db: BillingDB,
): Promise<Buffer> {
  const inv = await getInvoice(invoiceId, promoterId, db);

  // Build QR code if requested
  let qrCodeBase64: string | undefined;
  if (opts.includeQrCode && opts.seller.iban && inv.totalHalire > 0) {
    const qrInput: QrPaymentInput = {
      iban: opts.seller.iban,
      amountHalire: inv.totalHalire,
      currency: 'CZK',
      variableSymbol: inv.invoiceNumber.replace(/\D/g, '').slice(0, 10),
      note: `Faktura ${inv.invoiceNumber}`,
      dueDate: inv.dueDate,
    };
    try {
      const imgBuf = await generateQrCodeImage(qrInput);
      qrCodeBase64 = imgBuf.toString('base64');
    } catch {
      // QR generation optional — skip on failure
    }
  }

  const pdfData: InvoicePdfData = {
    invoiceNumber: inv.invoiceNumber,
    issueDate: inv.periodFrom,
    taxDate: inv.periodTo,
    dueDate: inv.dueDate,
    variableSymbol: inv.invoiceNumber,
    locale: opts.locale ?? 'cs',

    sellerName: opts.seller.name,
    sellerIco: opts.seller.ico,
    sellerDic: opts.seller.dic,
    sellerAddress: opts.seller.address,
    sellerBankAccount: opts.seller.bankAccount,

    buyerName: opts.buyer.name,
    buyerIco: opts.buyer.ico,
    buyerDic: opts.buyer.dic,
    buyerAddress: opts.buyer.address,

    currency: 'CZK',
    lines: inv.lineItems.map((li) => ({
      description: li.description,
      quantity: li.quantity,
      unit: 'ks',
      unitPriceHalire: li.unitPriceHalire,
      vatRatePercent: CZ_VAT_RATES_PERCENT.standard,
      subtotalHalire: li.unitPriceHalire * li.quantity,
      vatHalire: Math.round(li.unitPriceHalire * li.quantity * CZ_VAT_RATES_PERCENT.standard / 100),
      totalHalire: li.totalHalire,
    })),

    subtotalHalire: inv.platformFeesHalire,
    vatTotalHalire: inv.vatHalire,
    totalHalire: inv.totalHalire,

    vatBreakdown: [
      {
        ratePercent: CZ_VAT_RATES_PERCENT.standard,
        baseHalire: inv.platformFeesHalire,
        vatHalire: inv.vatHalire,
      },
    ],

    qrCodeBase64,
  };

  return generateInvoicePdf(pdfData);
}

/** Admin: list all invoices across all promoters, filtered by status/period. */
export async function listAllInvoices(
  filters: { status?: InvoiceStatus; from?: string; to?: string; limit?: number; offset?: number },
  db: BillingDB,
): Promise<{ items: Invoice[]; total: number }> {
  const conditions: string[] = ['1=1'];
  const params: unknown[] = [];
  let idx = 1;

  if (filters.status) { conditions.push(`status = $${idx++}`); params.push(filters.status); }
  if (filters.from)   { conditions.push(`period_from >= $${idx++}`); params.push(filters.from); }
  if (filters.to)     { conditions.push(`period_to <= $${idx++}`);   params.push(filters.to); }

  const where = conditions.join(' AND ');
  const limit = filters.limit ?? 100;
  const offset = filters.offset ?? 0;

  const totalRows = await db.query<{ count: string }>(
    `SELECT COUNT(*)::text AS count FROM platform.invoices WHERE ${where}`,
    params,
  );
  const total = parseInt(totalRows[0]?.count ?? '0', 10);

  const rows = await db.query<Record<string, unknown>>(
    `SELECT * FROM platform.invoices WHERE ${where}
     ORDER BY created_at DESC
     LIMIT $${idx++} OFFSET $${idx++}`,
    [...params, limit, offset],
  );
  return { items: rows.map(mapRow), total };
}
