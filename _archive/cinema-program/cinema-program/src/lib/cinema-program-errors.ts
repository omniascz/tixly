// ---------------------------------------------------------------------------
// Cinema Program — Error codes
// ---------------------------------------------------------------------------

export type CinemaProgramErrorCode =
  | 'AGE_VERIFICATION_REQUIRED'   // 403
  | 'AGE_TOO_YOUNG'               // 403
  | 'VERIFICATION_ALREADY_EXISTS' // 409
  | 'RULE_NOT_FOUND'              // 404
  | 'RULE_DUPLICATE'              // 409
  | 'RELEASE_NOT_FOUND'           // 404
  | 'RELEASE_DUPLICATE'           // 409
  | 'WIDGET_CONFIG_NOT_FOUND';    // 404

const HTTP_STATUS: Record<CinemaProgramErrorCode, number> = {
  AGE_VERIFICATION_REQUIRED: 403,
  AGE_TOO_YOUNG: 403,
  VERIFICATION_ALREADY_EXISTS: 409,
  RULE_NOT_FOUND: 404,
  RULE_DUPLICATE: 409,
  RELEASE_NOT_FOUND: 404,
  RELEASE_DUPLICATE: 409,
  WIDGET_CONFIG_NOT_FOUND: 404,
};

const DEFAULT_MESSAGES: Record<CinemaProgramErrorCode, string> = {
  AGE_VERIFICATION_REQUIRED: 'Age verification is required for this screening.',
  AGE_TOO_YOUNG: 'Buyer does not meet the minimum age requirement.',
  VERIFICATION_ALREADY_EXISTS: 'Age verification already exists for this user and screening.',
  RULE_NOT_FOUND: 'Age restriction rule not found.',
  RULE_DUPLICATE: 'An age restriction rule for this rating already exists for this promoter.',
  RELEASE_NOT_FOUND: 'Film release record not found.',
  RELEASE_DUPLICATE: 'A release record for this film and venue already exists.',
  WIDGET_CONFIG_NOT_FOUND: 'Widget configuration not found.',
};

export class CinemaProgramError extends Error {
  public readonly code: CinemaProgramErrorCode;
  public readonly statusCode: number;

  constructor(code: CinemaProgramErrorCode, message?: string) {
    super(message ?? DEFAULT_MESSAGES[code]);
    this.name = 'CinemaProgramError';
    this.code = code;
    this.statusCode = HTTP_STATUS[code];
    Object.setPrototypeOf(this, CinemaProgramError.prototype);
  }

  toHttpError() {
    return { error: this.code, message: this.message, statusCode: this.statusCode };
  }
}

export function isCinemaProgramError(err: unknown): err is CinemaProgramError {
  return err instanceof CinemaProgramError;
}
