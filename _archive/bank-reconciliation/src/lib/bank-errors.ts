export type BankReconciliationErrorCode =
  | 'FIO_NOT_CONFIGURED'
  | 'FIO_AUTH_FAILED'
  | 'FIO_API_ERROR'
  | 'IBAN_NOT_CONFIGURED'
  | 'INVALID_VARIABLE_SYMBOL'
  | 'PAYMENT_NOT_FOUND'
  | 'MATCH_FAILED';

const CODE_TO_STATUS: Record<BankReconciliationErrorCode, number> = {
  FIO_NOT_CONFIGURED: 500,
  FIO_AUTH_FAILED: 502,
  FIO_API_ERROR: 502,
  IBAN_NOT_CONFIGURED: 500,
  INVALID_VARIABLE_SYMBOL: 400,
  PAYMENT_NOT_FOUND: 404,
  MATCH_FAILED: 500,
};

const CODE_TO_MESSAGE_CS: Record<BankReconciliationErrorCode, string> = {
  FIO_NOT_CONFIGURED: 'Fio Banka API není nakonfigurováno (chybí FIO_TOKEN).',
  FIO_AUTH_FAILED: 'Autentizace k Fio Banka API selhala. Zkontrolujte token.',
  FIO_API_ERROR: 'Chyba při komunikaci s Fio Banka API.',
  IBAN_NOT_CONFIGURED: 'IBAN studia není nakonfigurováno (chybí STUDIO_IBAN).',
  INVALID_VARIABLE_SYMBOL: 'Neplatný variabilní symbol. Povoleny jsou 1-10 číslic.',
  PAYMENT_NOT_FOUND: 'Bankovní platba nebyla nalezena.',
  MATCH_FAILED: 'Párování bankovní platby selhalo.',
};

export class BankReconciliationError extends Error {
  public readonly code: BankReconciliationErrorCode;
  public readonly statusCode: number;
  public readonly details?: Record<string, unknown>;

  constructor(code: BankReconciliationErrorCode, details?: Record<string, unknown>) {
    super(CODE_TO_MESSAGE_CS[code]);
    this.name = 'BankReconciliationError';
    this.code = code;
    this.statusCode = CODE_TO_STATUS[code];
    this.details = details;
  }
}
