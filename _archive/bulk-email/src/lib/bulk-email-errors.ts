export type BulkEmailErrorCode =
  | 'CAMPAIGN_NOT_FOUND'
  | 'CAMPAIGN_ALREADY_SENT'
  | 'EMPTY_SEGMENT'
  | 'INVALID_SEGMENT'
  | 'RATE_LIMITED';

const STATUS_CODES: Record<BulkEmailErrorCode, number> = {
  CAMPAIGN_NOT_FOUND: 404,
  CAMPAIGN_ALREADY_SENT: 409,
  EMPTY_SEGMENT: 400,
  INVALID_SEGMENT: 400,
  RATE_LIMITED: 429,
};

const MESSAGES_CS: Record<BulkEmailErrorCode, string> = {
  CAMPAIGN_NOT_FOUND: 'Kampaň nebyla nalezena',
  CAMPAIGN_ALREADY_SENT: 'Kampaň již byla odeslána nebo je v průběhu',
  EMPTY_SEGMENT: 'Segment neobsahuje žádné příjemce',
  INVALID_SEGMENT: 'Neplatný segment',
  RATE_LIMITED: 'Překročen limit odesílání',
};

export class BulkEmailError extends Error {
  public readonly code: BulkEmailErrorCode;
  public readonly statusCode: number;

  constructor(code: BulkEmailErrorCode, message?: string) {
    super(message ?? MESSAGES_CS[code]);
    this.code = code;
    this.statusCode = STATUS_CODES[code];
    this.name = 'BulkEmailError';
  }

  toHttpError(): { error: string; message: string } {
    return { error: this.code, message: this.message };
  }
}

export function isBulkEmailError(err: unknown): err is BulkEmailError {
  return err instanceof BulkEmailError;
}
