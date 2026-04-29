// =============================================================================
// Badge Printing — Error definitions
// =============================================================================

export type BadgeErrorCode =
  | 'TEMPLATE_NOT_FOUND'
  | 'TEMPLATE_DUPLICATE'
  | 'JOB_NOT_FOUND'
  | 'JOB_ALREADY_PROCESSING'
  | 'ACTIVATION_NOT_FOUND'
  | 'BADGE_GENERATION_FAILED';

const HTTP_STATUS: Record<BadgeErrorCode, number> = {
  TEMPLATE_NOT_FOUND:      404,
  TEMPLATE_DUPLICATE:      409,
  JOB_NOT_FOUND:           404,
  JOB_ALREADY_PROCESSING:  409,
  ACTIVATION_NOT_FOUND:    404,
  BADGE_GENERATION_FAILED: 500,
};

const DEFAULT_MESSAGES: Record<BadgeErrorCode, string> = {
  TEMPLATE_NOT_FOUND:      'Badge template not found.',
  TEMPLATE_DUPLICATE:      'A badge template with this name already exists for this conference.',
  JOB_NOT_FOUND:           'Badge print job not found.',
  JOB_ALREADY_PROCESSING:  'This print job is already being processed.',
  ACTIVATION_NOT_FOUND:    'Pass activation not found.',
  BADGE_GENERATION_FAILED: 'Failed to generate badge.',
};

export class BadgeError extends Error {
  public readonly code: BadgeErrorCode;
  public readonly statusCode: number;

  constructor(code: BadgeErrorCode, message?: string) {
    super(message ?? DEFAULT_MESSAGES[code]);
    this.name = 'BadgeError';
    this.code = code;
    this.statusCode = HTTP_STATUS[code];
    Object.setPrototypeOf(this, BadgeError.prototype);
  }

  toHttpError() {
    return { error: this.code, message: this.message, statusCode: this.statusCode };
  }
}

export function isBadgeError(err: unknown): err is BadgeError {
  return err instanceof BadgeError;
}

/** Returns true when err is a PostgreSQL unique-constraint violation (23505). */
export function isPgUniqueViolation(err: unknown, constraintName?: string): boolean {
  const e = err as { code?: string; constraint?: string };
  if (e?.code !== '23505') return false;
  if (constraintName && e.constraint) return e.constraint.includes(constraintName);
  return true;
}
