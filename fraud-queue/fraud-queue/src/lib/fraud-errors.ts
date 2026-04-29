export type FraudErrorCode =
  | 'CASE_NOT_FOUND'           // 404
  | 'CASE_ALREADY_RESOLVED'    // 409 — already cleared or confirmed_fraud
  | 'CASE_ALREADY_CLAIMED'     // 409 — claimed by another CS agent
  | 'NOTES_REQUIRED'           // 422 — confirm_fraud / escalate requires notes
  | 'DUPLICATE_ORDER'          // 409 — order already has a fraud case
  | 'DUPLICATE_SOURCE_REF'     // 409 — same source_module + source_ref_id already queued
  | 'UNAUTHORIZED';            // 401

const HTTP_STATUS: Record<FraudErrorCode, number> = {
  CASE_NOT_FOUND: 404,
  CASE_ALREADY_RESOLVED: 409,
  CASE_ALREADY_CLAIMED: 409,
  NOTES_REQUIRED: 422,
  DUPLICATE_ORDER: 409,
  DUPLICATE_SOURCE_REF: 409,
  UNAUTHORIZED: 401,
};

const DEFAULT_MESSAGES: Record<FraudErrorCode, string> = {
  CASE_NOT_FOUND: 'Fraud case not found.',
  CASE_ALREADY_RESOLVED: 'This fraud case has already been resolved.',
  CASE_ALREADY_CLAIMED: 'This case is already claimed by another CS agent.',
  NOTES_REQUIRED: 'Notes are required for this review decision.',
  DUPLICATE_ORDER: 'A fraud case already exists for this order.',
  DUPLICATE_SOURCE_REF: 'A fraud case already exists for this source reference.',
  UNAUTHORIZED: 'Admin authentication required.',
};

export class FraudError extends Error {
  public readonly code: FraudErrorCode;
  public readonly statusCode: number;

  constructor(code: FraudErrorCode, message?: string) {
    super(message ?? DEFAULT_MESSAGES[code]);
    this.name = 'FraudError';
    this.code = code;
    this.statusCode = HTTP_STATUS[code];
    Object.setPrototypeOf(this, FraudError.prototype);
  }

  toHttpError() {
    return { error: this.code, message: this.message, statusCode: this.statusCode };
  }
}

export function isFraudError(err: unknown): err is FraudError {
  return err instanceof FraudError;
}
