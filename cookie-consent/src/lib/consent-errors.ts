export type ConsentErrorCode =
  | 'BANNER_NOT_CONFIGURED'
  | 'INVALID_CONSENT'
  | 'VERSION_MISMATCH'
  | 'UNAUTHORIZED'
  | 'NOT_FOUND'
  | 'UNPROCESSABLE';

const STATUS_MAP: Record<ConsentErrorCode, number> = {
  BANNER_NOT_CONFIGURED: 404,
  INVALID_CONSENT: 400,
  VERSION_MISMATCH: 409,
  UNAUTHORIZED: 401,
  NOT_FOUND: 404,
  UNPROCESSABLE: 422,
};

const MESSAGES: Record<ConsentErrorCode, string> = {
  BANNER_NOT_CONFIGURED: 'Cookie banner není nakonfigurován.',
  INVALID_CONSENT: 'Neplatný souhlas s cookies.',
  VERSION_MISMATCH: 'Verze banneru se neshoduje, vyžádejte si nový souhlas.',
  UNAUTHORIZED: 'Nejste autorizováni pro tento souhlas.',
  NOT_FOUND: 'Souhlas nenalezen.',
  UNPROCESSABLE: 'Nelze zpracovat požadavek.',
};

export class ConsentError extends Error {
  public readonly code: ConsentErrorCode;
  public readonly status: number;

  constructor(code: ConsentErrorCode, message?: string) {
    super(message ?? MESSAGES[code]);
    this.name = 'ConsentError';
    this.code = code;
    this.status = STATUS_MAP[code];
  }
}
