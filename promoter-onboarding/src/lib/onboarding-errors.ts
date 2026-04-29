export type OnboardingErrorCode =
  | 'EMAIL_ALREADY_REGISTERED'    // 409
  | 'EMAIL_NOT_VERIFIED'          // 422
  | 'VERIFICATION_TOKEN_INVALID'  // 400
  | 'VERIFICATION_TOKEN_EXPIRED'  // 400
  | 'VERIFICATION_TOKEN_USED'     // 400
  | 'PROMOTER_ALREADY_EXISTS'     // 409 — user má již promotéra
  | 'INVALID_ICO'                 // 422 — IČO není 8 číslic
  | 'INVALID_IBAN'                // 422
  | 'KYC_ALREADY_SUBMITTED'       // 409
  | 'KYC_NOT_SUBMITTED'           // 422 — nelze reviewovat co nebylo odesláno
  | 'ONBOARDING_NOT_FOUND'        // 404
  | 'INVALID_REVIEW_DECISION'     // 422
  | 'NOTES_REQUIRED'              // 422 — při rejected/request_more_info
  | 'INVALID_STATUS_TRANSITION'   // 422 — nepovolený přechod stavu promotéra
  | 'DOCUMENT_NOT_FOUND'          // 404 — KYC dokument neexistuje
  | 'UNAUTHORIZED'               // 401
  | 'WIZARD_NOT_FOUND'           // 404 — wizardId not in Redis or expired
  | 'WIZARD_INVALID_PROMOTER'    // 403 — wizard belongs to different promoter
  | 'WIZARD_INCOMPLETE';         // 422 — required fields missing for completion

const HTTP_STATUS: Record<OnboardingErrorCode, number> = {
  EMAIL_ALREADY_REGISTERED: 409,
  EMAIL_NOT_VERIFIED: 422,
  VERIFICATION_TOKEN_INVALID: 400,
  VERIFICATION_TOKEN_EXPIRED: 400,
  VERIFICATION_TOKEN_USED: 400,
  PROMOTER_ALREADY_EXISTS: 409,
  INVALID_ICO: 422,
  INVALID_IBAN: 422,
  KYC_ALREADY_SUBMITTED: 409,
  KYC_NOT_SUBMITTED: 422,
  ONBOARDING_NOT_FOUND: 404,
  INVALID_REVIEW_DECISION: 422,
  NOTES_REQUIRED: 422,
  INVALID_STATUS_TRANSITION: 422,
  DOCUMENT_NOT_FOUND: 404,
  UNAUTHORIZED: 401,
  WIZARD_NOT_FOUND: 404,
  WIZARD_INVALID_PROMOTER: 403,
  WIZARD_INCOMPLETE: 422,
};

const DEFAULT_MESSAGES: Record<OnboardingErrorCode, string> = {
  EMAIL_ALREADY_REGISTERED: 'This email address is already registered.',
  EMAIL_NOT_VERIFIED: 'Email address has not been verified.',
  VERIFICATION_TOKEN_INVALID: 'Verification token is invalid.',
  VERIFICATION_TOKEN_EXPIRED: 'Verification token has expired.',
  VERIFICATION_TOKEN_USED: 'Verification token has already been used.',
  PROMOTER_ALREADY_EXISTS: 'A promoter account already exists for this user.',
  INVALID_ICO: 'IČO must be exactly 8 digits.',
  INVALID_IBAN: 'Invalid Czech IBAN format. Expected: CZ followed by 22 digits.',
  KYC_ALREADY_SUBMITTED: 'KYC documents have already been submitted.',
  KYC_NOT_SUBMITTED: 'KYC documents have not been submitted yet.',
  ONBOARDING_NOT_FOUND: 'Onboarding record not found.',
  INVALID_REVIEW_DECISION: 'Invalid KYC review decision.',
  NOTES_REQUIRED: 'Notes are required when rejecting or requesting more information.',
  INVALID_STATUS_TRANSITION: 'This status transition is not allowed.',
  DOCUMENT_NOT_FOUND: 'KYC document not found.',
  UNAUTHORIZED: 'Unauthorized.',
  WIZARD_NOT_FOUND: 'Wizard session not found or has expired.',
  WIZARD_INVALID_PROMOTER: 'This wizard session belongs to a different promoter.',
  WIZARD_INCOMPLETE: 'Required fields are missing. Please complete all mandatory event details.',
};

export interface HttpError {
  error: OnboardingErrorCode;
  message: string;
  statusCode: number;
}

export class OnboardingError extends Error {
  public readonly code: OnboardingErrorCode;
  public readonly statusCode: number;

  constructor(code: OnboardingErrorCode, message?: string) {
    super(message ?? DEFAULT_MESSAGES[code]);
    this.name = 'OnboardingError';
    this.code = code;
    this.statusCode = HTTP_STATUS[code];
    Object.setPrototypeOf(this, OnboardingError.prototype);
  }

  toHttpError(): HttpError {
    return {
      error: this.code,
      message: this.message,
      statusCode: this.statusCode,
    };
  }
}

export function isOnboardingError(err: unknown): err is OnboardingError {
  return err instanceof OnboardingError;
}

export class RateLimitError extends Error {
  readonly statusCode = 429
  readonly code = 'RATE_LIMIT_EXCEEDED'
  constructor(message = 'Too many requests') {
    super(message)
    this.name = 'RateLimitError'
    Object.setPrototypeOf(this, RateLimitError.prototype)
  }
}
