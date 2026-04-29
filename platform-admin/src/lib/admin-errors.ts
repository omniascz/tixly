export type AdminErrorCode =
  | 'PROMOTER_NOT_FOUND'      // 404
  | 'PAYOUT_NOT_FOUND'        // 404
  | 'NOTIFICATION_NOT_FOUND'  // 404
  | 'INVALID_ACTION'          // 422
  | 'BULK_PARTIALLY_FAILED'   // 207 — bulk operace, část selhala
  | 'UNAUTHORIZED';           // 401

const STATUS_CODES: Record<AdminErrorCode, number> = {
  PROMOTER_NOT_FOUND: 404,
  PAYOUT_NOT_FOUND: 404,
  NOTIFICATION_NOT_FOUND: 404,
  INVALID_ACTION: 422,
  BULK_PARTIALLY_FAILED: 207,
  UNAUTHORIZED: 401,
};

export class AdminError extends Error {
  public readonly code: AdminErrorCode;
  public readonly statusCode: number;
  public readonly details?: unknown;

  constructor(code: AdminErrorCode, message: string, details?: unknown) {
    super(message);
    this.name = 'AdminError';
    this.code = code;
    this.statusCode = STATUS_CODES[code];
    this.details = details;
  }

  toHttpError(): { error: string; code: AdminErrorCode; details?: unknown } {
    return {
      error: this.message,
      code: this.code,
      ...(this.details !== undefined ? { details: this.details } : {}),
    };
  }
}

export function isAdminError(err: unknown): err is AdminError {
  return err instanceof AdminError;
}
