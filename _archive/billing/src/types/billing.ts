export type InvoiceStatus = 'draft' | 'issued' | 'paid' | 'overdue' | 'void' | 'reversed';
export type CreditNoteStatus = 'draft' | 'issued' | 'void';

export interface Invoice {
  id: string;
  promoterId: string;
  invoiceNumber: string;
  periodFrom: string;   // YYYY-MM-DD
  periodTo: string;     // YYYY-MM-DD
  grossRevenueHalire: number;
  platformFeesHalire: number;
  vatHalire: number;
  totalHalire: number;
  status: InvoiceStatus;
  dueDate: string;      // YYYY-MM-DD
  paidAt: string | null;
  notes: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface InvoiceLineItem {
  id: string;
  invoiceId: string;
  description: string;
  quantity: number;
  unitPriceHalire: number;
  totalHalire: number;
  createdAt: string;
}

export interface InvoiceWithLines extends Invoice {
  lineItems: InvoiceLineItem[];
}

export interface GenerateInvoiceInput {
  promoterId: string;
  /** YYYY-MM format, e.g. "2026-04" */
  period: string;
  dueInDays?: number;    // default 14
  notes?: string;
}

export interface UpdateInvoiceInput {
  status?: InvoiceStatus;
  paidAt?: string | null;
  notes?: string | null;
}

/** Aggregated fee data from platform.payouts for the billing period. */
export interface PeriodFeeSummary {
  grossRevenueHalire: number;
  platformFeesHalire: number;
  payoutCount: number;
}

// ---------------------------------------------------------------------------
// Credit notes
// ---------------------------------------------------------------------------

export interface CreditNote {
  id: string;
  promoterId: string;
  originalInvoiceId: string;
  creditNoteNumber: string;
  reason: string;
  /** Credited base amount in haléře (positive number) */
  subtotalHalire: number;
  vatHalire: number;
  totalHalire: number;
  status: CreditNoteStatus;
  issueDate: string;
  createdAt: string;
  updatedAt: string;
}

export interface CreditNoteLineItem {
  id: string;
  creditNoteId: string;
  description: string;
  quantity: number;
  unitPriceHalire: number;
  vatRatePercent: number;
  subtotalHalire: number;
  vatHalire: number;
  totalHalire: number;
}

export interface CreditNoteWithLines extends CreditNote {
  lineItems: CreditNoteLineItem[];
  originalInvoiceNumber: string;
}

export interface CreateCreditNoteInput {
  promoterId: string;
  originalInvoiceId: string;
  reason: string;
  issueDate: string;
  /** If provided, only credit these line indexes (0-based). Otherwise credit all lines. */
  lineIndexes?: number[];
  /** Override quantities per line index for partial credits. */
  lineOverrides?: Record<number, { quantity?: number; unitPriceHalire?: number }>;
}
