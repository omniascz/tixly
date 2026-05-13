export type MicroOrganizerErrorCode =
  | 'EMAIL_ALREADY_REGISTERED'     // 409
  | 'EMAIL_NOT_VERIFIED'           // 403
  | 'VERIFICATION_TOKEN_INVALID'   // 400
  | 'VERIFICATION_TOKEN_EXPIRED'   // 400
  | 'VERIFICATION_TOKEN_USED'      // 400
  | 'ORGANIZER_NOT_FOUND'          // 404
  | 'UNAUTHORIZED'                 // 403
  | 'EVENT_LIMIT_REACHED'          // 409 — mikro-pořadatel může mít max 3 aktivní akce před upgradem
  | 'UPGRADE_REQUIRED';            // 402 — pokus o výplatu bez úplného profilu

const HTTP_STATUS: Record<MicroOrganizerErrorCode, number> = {
  EMAIL_ALREADY_REGISTERED: 409,
  EMAIL_NOT_VERIFIED: 403,
  VERIFICATION_TOKEN_INVALID: 400,
  VERIFICATION_TOKEN_EXPIRED: 400,
  VERIFICATION_TOKEN_USED: 400,
  ORGANIZER_NOT_FOUND: 404,
  UNAUTHORIZED: 403,
  EVENT_LIMIT_REACHED: 409,
  UPGRADE_REQUIRED: 402,
};

const DEFAULT_MESSAGES: Record<MicroOrganizerErrorCode, string> = {
  EMAIL_ALREADY_REGISTERED: 'Tento e-mail je již zaregistrován.',
  EMAIL_NOT_VERIFIED: 'E-mailová adresa nebyla ověřena.',
  VERIFICATION_TOKEN_INVALID: 'Ověřovací token je neplatný.',
  VERIFICATION_TOKEN_EXPIRED: 'Ověřovací token vypršel.',
  VERIFICATION_TOKEN_USED: 'Ověřovací token byl již použit.',
  ORGANIZER_NOT_FOUND: 'Pořadatel nebyl nalezen.',
  UNAUTHORIZED: 'Přístup odepřen.',
  EVENT_LIMIT_REACHED:
    'Dosáhli jste limitu 3 aktivních akcí. Pro více akcí přejděte na plný účet.',
  UPGRADE_REQUIRED:
    'Pro výplatu je nutné dokončit upgrade účtu (doplnit IČO a IBAN).',
};

export interface HttpError {
  error: MicroOrganizerErrorCode;
  message: string;
  statusCode: number;
}

export class MicroOrganizerError extends Error {
  public readonly code: MicroOrganizerErrorCode;
  public readonly statusCode: number;

  constructor(code: MicroOrganizerErrorCode, message?: string) {
    super(message ?? DEFAULT_MESSAGES[code]);
    this.name = 'MicroOrganizerError';
    this.code = code;
    this.statusCode = HTTP_STATUS[code];
    Object.setPrototypeOf(this, MicroOrganizerError.prototype);
  }

  toHttpError(): HttpError {
    return {
      error: this.code,
      message: this.message,
      statusCode: this.statusCode,
    };
  }
}

export function isMicroOrganizerError(err: unknown): err is MicroOrganizerError {
  return err instanceof MicroOrganizerError;
}

export class RateLimitError extends Error {
  readonly statusCode = 429;
  readonly code = 'RATE_LIMIT_EXCEEDED';

  constructor(message = 'Příliš mnoho požadavků. Zkuste to prosím později.') {
    super(message);
    this.name = 'RateLimitError';
    Object.setPrototypeOf(this, RateLimitError.prototype);
  }
}
