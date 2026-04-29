// =============================================================================
// GoPay Payments — Error types (české zprávy)
// =============================================================================

export type GopayErrorCode =
  | 'GOPAY_NOT_CONFIGURED'        // 500 — chybí ENV proměnné
  | 'GOPAY_AUTH_FAILED'           // 502 — OAuth2 token request selhal
  | 'GOPAY_API_ERROR'             // 502 — obecná chyba GoPay REST API
  | 'GOPAY_PAYMENT_NOT_FOUND'     // 404 — platba neexistuje
  | 'GOPAY_INVALID_WEBHOOK'       // 400 — neplatný webhook payload
  | 'GOPAY_INVALID_AMOUNT';       // 400 — neplatná částka (např. <= 0)

const HTTP_STATUS: Record<GopayErrorCode, number> = {
  GOPAY_NOT_CONFIGURED:    500,
  GOPAY_AUTH_FAILED:       502,
  GOPAY_API_ERROR:         502,
  GOPAY_PAYMENT_NOT_FOUND: 404,
  GOPAY_INVALID_WEBHOOK:   400,
  GOPAY_INVALID_AMOUNT:    400,
};

const DEFAULT_MESSAGES: Record<GopayErrorCode, string> = {
  GOPAY_NOT_CONFIGURED:    'GoPay není nakonfigurováno. Chybí povinné ENV proměnné (GOPAY_GOID, GOPAY_CLIENT_ID, GOPAY_CLIENT_SECRET).',
  GOPAY_AUTH_FAILED:       'Ověření vůči GoPay OAuth2 selhalo. Zkontrolujte CLIENT_ID a CLIENT_SECRET.',
  GOPAY_API_ERROR:         'GoPay API vrátilo chybu.',
  GOPAY_PAYMENT_NOT_FOUND: 'Platba nebyla nalezena.',
  GOPAY_INVALID_WEBHOOK:   'Neplatný webhook payload od GoPay.',
  GOPAY_INVALID_AMOUNT:    'Neplatná částka platby. Částka musí být kladné celé číslo v haléřích.',
};

export class GopayError extends Error {
  public readonly code: GopayErrorCode;
  public readonly statusCode: number;

  constructor(code: GopayErrorCode, message?: string) {
    super(message ?? DEFAULT_MESSAGES[code]);
    this.name = 'GopayError';
    this.code = code;
    this.statusCode = HTTP_STATUS[code];
    Object.setPrototypeOf(this, GopayError.prototype);
  }

  toHttpError() {
    return { error: this.code, message: this.message, statusCode: this.statusCode };
  }
}

export function isGopayError(err: unknown): err is GopayError {
  return err instanceof GopayError;
}
