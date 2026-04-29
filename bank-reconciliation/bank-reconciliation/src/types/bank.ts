export interface FioTransaction {
  /** Fio's internal transaction ID */
  id: string;
  /** Date in ISO format */
  date: string;
  amountHalire: number;
  currency: string;
  /** Variable symbol — Czech invoice/order reference */
  variableSymbol: string | null;
  /** Constant symbol */
  constantSymbol: string | null;
  /** Specific symbol */
  specificSymbol: string | null;
  /** Counterparty account number */
  counterAccount: string | null;
  counterAccountName: string | null;
  /** Free-text message */
  message: string | null;
  /** 'PRIJEM' (incoming) | 'VYDAJ' (outgoing) */
  type: 'PRIJEM' | 'VYDAJ' | string;
}

export type BankPaymentMatchStatus =
  | 'unmatched'
  | 'matched'
  | 'partial_match'
  | 'overpaid'
  | 'underpaid'
  | 'multi_match'
  | 'manual_review';

export interface BankPaymentRecord {
  id: string;
  fioTransactionId: string;
  amountHalire: number;
  currency: string;
  variableSymbol: string | null;
  orderId: string | null;
  matchStatus: BankPaymentMatchStatus;
  receivedAt: Date;
  matchedAt: Date | null;
  rawPayload: Record<string, unknown>;
}

export interface SpaydQrInput {
  amountHalire: number;
  variableSymbol: string;
  message?: string;
  /** ISO date when payment is due — informational only */
  dueDate?: string;
}

export interface SpaydQrResult {
  /** Plain SPAYD string */
  spayd: string;
  /** Data URL `data:image/png;base64,...` */
  qrPngDataUrl: string;
}
