export type PayoutErrorCode =
  | 'PAYOUT_NOT_FOUND'              // 404
  | 'PAYOUT_SETTINGS_NOT_FOUND'     // 404
  | 'SETTLEMENT_NOT_FOUND'          // 404
  | 'INVALID_STATUS_TRANSITION'     // 422
  | 'PAYOUT_BELOW_MINIMUM'          // 422 — net_payout < min_payout_amount
  | 'ALREADY_PROCESSING'            // 409 — již probíhá výplata
  | 'BANK_ACCOUNT_MISSING'          // 422 — promotér nemá bankovní účet
  | 'UNAUTHORIZED';                 // 403

const STATUS_CODES: Record<PayoutErrorCode, number> = {
  PAYOUT_NOT_FOUND: 404,
  PAYOUT_SETTINGS_NOT_FOUND: 404,
  SETTLEMENT_NOT_FOUND: 404,
  INVALID_STATUS_TRANSITION: 422,
  PAYOUT_BELOW_MINIMUM: 422,
  ALREADY_PROCESSING: 409,
  BANK_ACCOUNT_MISSING: 422,
  UNAUTHORIZED: 403,
};

const DEFAULT_MESSAGES: Record<PayoutErrorCode, string> = {
  PAYOUT_NOT_FOUND: 'Výplata nebyla nalezena.',
  PAYOUT_SETTINGS_NOT_FOUND: 'Nastavení výplat nebylo nalezeno.',
  SETTLEMENT_NOT_FOUND: 'Settlement nebyl nalezen.',
  INVALID_STATUS_TRANSITION: 'Neplatný přechod stavu výplaty.',
  PAYOUT_BELOW_MINIMUM: 'Výplata je nižší než minimální povolená částka.',
  ALREADY_PROCESSING: 'Výplata již probíhá.',
  BANK_ACCOUNT_MISSING: 'Promotér nemá zadán bankovní účet.',
  UNAUTHORIZED: 'Přístup odepřen.',
};

export class PayoutError extends Error {
  public readonly code: PayoutErrorCode;
  public readonly statusCode: number;

  constructor(code: PayoutErrorCode, message?: string) {
    super(message ?? DEFAULT_MESSAGES[code]);
    this.name = 'PayoutError';
    this.code = code;
    this.statusCode = STATUS_CODES[code];
    Object.setPrototypeOf(this, PayoutError.prototype);
  }

  toHttpError(): { error: { code: PayoutErrorCode; message: string }; statusCode: number } {
    return {
      statusCode: this.statusCode,
      error: {
        code: this.code,
        message: this.message,
      },
    };
  }
}
