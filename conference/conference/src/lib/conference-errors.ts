// =============================================================================
// Conference — Error definitions
// =============================================================================

export type ConferenceErrorCode =
  | 'CONFERENCE_NOT_FOUND'
  | 'DAY_NOT_FOUND'
  | 'SESSION_NOT_FOUND'
  | 'TRACK_NOT_FOUND'
  | 'SPEAKER_NOT_FOUND'
  | 'SPEAKER_DUPLICATE'
  | 'PASS_NOT_FOUND'
  | 'PASS_SOLD_OUT'
  | 'PASS_SALE_CLOSED'
  | 'PASS_ALREADY_ACTIVATED'
  | 'SESSION_OVERLAP'
  | 'INVALID_SESSION_TYPE';

const HTTP_STATUS: Record<ConferenceErrorCode, number> = {
  CONFERENCE_NOT_FOUND:    404,
  DAY_NOT_FOUND:           404,
  SESSION_NOT_FOUND:       404,
  TRACK_NOT_FOUND:         404,
  SPEAKER_NOT_FOUND:       404,
  SPEAKER_DUPLICATE:       409,
  PASS_NOT_FOUND:          404,
  PASS_SOLD_OUT:           409,
  PASS_SALE_CLOSED:        422,
  PASS_ALREADY_ACTIVATED:  409,
  SESSION_OVERLAP:         422,
  INVALID_SESSION_TYPE:    422,
};

const DEFAULT_MESSAGES: Record<ConferenceErrorCode, string> = {
  CONFERENCE_NOT_FOUND:    'Conference not found.',
  DAY_NOT_FOUND:           'Conference day not found.',
  SESSION_NOT_FOUND:       'Session not found.',
  TRACK_NOT_FOUND:         'Track not found.',
  SPEAKER_NOT_FOUND:       'Speaker not found.',
  SPEAKER_DUPLICATE:       'A speaker with this name already exists for this promoter.',
  PASS_NOT_FOUND:          'Multi-day pass not found.',
  PASS_SOLD_OUT:           'This pass is sold out.',
  PASS_SALE_CLOSED:        'Pass sales are not currently open.',
  PASS_ALREADY_ACTIVATED:  'This pass has already been activated for this user.',
  SESSION_OVERLAP:         'Session overlaps with an existing session in the same room.',
  INVALID_SESSION_TYPE:    'Invalid session type.',
};

export class ConferenceError extends Error {
  public readonly code: ConferenceErrorCode;
  public readonly statusCode: number;

  constructor(code: ConferenceErrorCode, message?: string) {
    super(message ?? DEFAULT_MESSAGES[code]);
    this.name = 'ConferenceError';
    this.code = code;
    this.statusCode = HTTP_STATUS[code];
    Object.setPrototypeOf(this, ConferenceError.prototype);
  }

  toHttpError() {
    return { error: this.code, message: this.message, statusCode: this.statusCode };
  }
}

export function isConferenceError(err: unknown): err is ConferenceError {
  return err instanceof ConferenceError;
}

/** Returns true when err is a PostgreSQL unique-constraint violation (23505). */
export function isPgUniqueViolation(err: unknown, constraintName?: string): boolean {
  const e = err as { code?: string; constraint?: string };
  if (e?.code !== '23505') return false;
  if (constraintName && e.constraint) return e.constraint.includes(constraintName);
  return true;
}
