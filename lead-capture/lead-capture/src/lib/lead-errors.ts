export type LeadCaptureErrorCode =
  | 'LEAD_NOT_FOUND'
  | 'EMAIL_INVALID'
  | 'CONSENT_REQUIRED'
  | 'RATE_LIMITED';

const MESSAGES: Record<LeadCaptureErrorCode, string> = {
  LEAD_NOT_FOUND: 'Poptávka nebyla nalezena.',
  EMAIL_INVALID: 'Neplatná e-mailová adresa.',
  CONSENT_REQUIRED: 'Pro odeslání poptávky je nutný souhlas se zpracováním osobních údajů.',
  RATE_LIMITED: 'Příliš mnoho pokusů. Zkuste to prosím za chvíli.',
};

const STATUS_CODES: Record<LeadCaptureErrorCode, number> = {
  LEAD_NOT_FOUND: 404,
  EMAIL_INVALID: 400,
  CONSENT_REQUIRED: 400,
  RATE_LIMITED: 429,
};

export class LeadCaptureError extends Error {
  public readonly code: LeadCaptureErrorCode;
  public readonly statusCode: number;

  constructor(code: LeadCaptureErrorCode, message?: string) {
    super(message ?? MESSAGES[code]);
    this.name = 'LeadCaptureError';
    this.code = code;
    this.statusCode = STATUS_CODES[code];
  }
}
