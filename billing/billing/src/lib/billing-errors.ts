export type BillingErrorCode =
  | 'INVOICE_NOT_FOUND'
  | 'INVOICE_ALREADY_EXISTS'      // invoice for this promoter/period already exists
  | 'INVOICE_INVALID_STATUS'      // cannot transition to requested status
  | 'INVOICE_INVALID_PERIOD'      // malformed period string
  | 'PROMOTER_NOT_FOUND'
  | 'NO_FEE_DATA'                 // no fee transactions in period
  | 'INVOICE_AMOUNT_MISMATCH'     // bank reconciliation: tx amount doesn't match invoice total
  | 'INVOICE_ALREADY_PAID'        // reconciliation target already paid
  | 'INVOICE_NOT_VOIDABLE'        // void requires draft/issued/overdue
  | 'CREDIT_NOTE_INVALID_SOURCE'  // original invoice not in creditable status
  | 'CREDIT_NOTE_EXCEEDS_AMOUNT'  // credit amount > original invoice total
  | 'CREDIT_NOTE_LINE_NOT_FOUND'; // referenced line index doesn't exist

const HTTP_STATUS: Record<BillingErrorCode, number> = {
  INVOICE_NOT_FOUND: 404,
  INVOICE_ALREADY_EXISTS: 409,
  INVOICE_INVALID_STATUS: 409,
  INVOICE_INVALID_PERIOD: 400,
  PROMOTER_NOT_FOUND: 404,
  NO_FEE_DATA: 422,
  INVOICE_AMOUNT_MISMATCH: 422,
  INVOICE_ALREADY_PAID: 409,
  INVOICE_NOT_VOIDABLE: 409,
  CREDIT_NOTE_INVALID_SOURCE: 409,
  CREDIT_NOTE_EXCEEDS_AMOUNT: 422,
  CREDIT_NOTE_LINE_NOT_FOUND: 404,
};

const DEFAULT_MESSAGES: Record<BillingErrorCode, string> = {
  INVOICE_NOT_FOUND: 'Faktura nebyla nalezena.',
  INVOICE_ALREADY_EXISTS: 'Faktura pro toto období již existuje.',
  INVOICE_INVALID_STATUS: 'Nepovolen přechod do požadovaného stavu faktury.',
  INVOICE_INVALID_PERIOD: 'Neplatný formát období (očekáváno YYYY-MM).',
  PROMOTER_NOT_FOUND: 'Promotér nebyl nalezen.',
  NO_FEE_DATA: 'V daném období nebyly nalezeny žádné poplatky k fakturaci.',
  INVOICE_AMOUNT_MISMATCH: 'Částka bankovní transakce neodpovídá celkové částce faktury.',
  INVOICE_ALREADY_PAID: 'Faktura je již označena jako zaplacená.',
  INVOICE_NOT_VOIDABLE: 'Fakturu v tomto stavu nelze stornovat.',
  CREDIT_NOTE_INVALID_SOURCE: 'Dobropis lze vytvořit pouze k vydané nebo zaplacené faktuře.',
  CREDIT_NOTE_EXCEEDS_AMOUNT: 'Částka dobropisu převyšuje částku původní faktury.',
  CREDIT_NOTE_LINE_NOT_FOUND: 'Odkazovaná řádka faktury nebyla nalezena.',
};

export class BillingError extends Error {
  public readonly code: BillingErrorCode;
  public readonly statusCode: number;

  constructor(code: BillingErrorCode, message?: string) {
    super(message ?? DEFAULT_MESSAGES[code]);
    this.name = 'BillingError';
    this.code = code;
    this.statusCode = HTTP_STATUS[code];
    Object.setPrototypeOf(this, BillingError.prototype);
  }

  toHttpError() {
    return { error: this.code, message: this.message, statusCode: this.statusCode };
  }
}

export function isBillingError(err: unknown): err is BillingError {
  return err instanceof BillingError;
}
