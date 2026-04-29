// =============================================================================
// Typed errors pro zákaznický portál (kupec vstupenky na akci)
// =============================================================================

export type BuyerPortalErrorCode =
  | 'UNAUTHORIZED'      // 401
  | 'TICKET_NOT_FOUND'  // 404
  | 'ORDER_NOT_FOUND'   // 404
  | 'TICKET_NOT_OWNED'  // 403 — pouze pro admin endpointy, jinak používat TICKET_NOT_FOUND
  | 'INTERNAL_ERROR';   // 500

const HTTP_STATUS: Record<BuyerPortalErrorCode, number> = {
  UNAUTHORIZED: 401,
  TICKET_NOT_FOUND: 404,
  ORDER_NOT_FOUND: 404,
  TICKET_NOT_OWNED: 403,
  INTERNAL_ERROR: 500,
};

const DEFAULT_MESSAGES: Record<BuyerPortalErrorCode, string> = {
  UNAUTHORIZED: 'Pro tuto akci je nutné přihlášení.',
  TICKET_NOT_FOUND: 'Vstupenka nebyla nalezena.',
  ORDER_NOT_FOUND: 'Objednávka nebyla nalezena.',
  TICKET_NOT_OWNED: 'Vstupenka nepatří přihlášenému uživateli.',
  INTERNAL_ERROR: 'Došlo k interní chybě serveru.',
};

export interface HttpError {
  error: BuyerPortalErrorCode;
  message: string;
  statusCode: number;
}

export class BuyerPortalError extends Error {
  public readonly code: BuyerPortalErrorCode;
  public readonly statusCode: number;

  constructor(code: BuyerPortalErrorCode, message?: string) {
    super(message ?? DEFAULT_MESSAGES[code]);
    this.name = 'BuyerPortalError';
    this.code = code;
    this.statusCode = HTTP_STATUS[code];
    Object.setPrototypeOf(this, BuyerPortalError.prototype);
  }

  toHttpError(): HttpError {
    return {
      error: this.code,
      message: this.message,
      statusCode: this.statusCode,
    };
  }
}

export function isBuyerPortalError(err: unknown): err is BuyerPortalError {
  return err instanceof BuyerPortalError;
}
