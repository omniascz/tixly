// =============================================================================
// Exhibitor Management — Error definitions
// =============================================================================

export type ExhibitorErrorCode =
  | 'FLOOR_MAP_NOT_FOUND'
  | 'FLOOR_MAP_DUPLICATE'
  | 'BOOTH_NOT_FOUND'
  | 'BOOTH_ALREADY_ASSIGNED'
  | 'BOOTH_NOT_AVAILABLE'
  | 'EXHIBITOR_NOT_FOUND'
  | 'EXHIBITOR_DUPLICATE'
  | 'STAFF_NOT_FOUND'
  | 'STAFF_DUPLICATE'
  | 'CATEGORY_NOT_FOUND'
  | 'ASSIGNMENT_NOT_FOUND';

const HTTP_STATUS: Record<ExhibitorErrorCode, number> = {
  FLOOR_MAP_NOT_FOUND:    404,
  FLOOR_MAP_DUPLICATE:    409,
  BOOTH_NOT_FOUND:        404,
  BOOTH_ALREADY_ASSIGNED: 409,
  BOOTH_NOT_AVAILABLE:    422,
  EXHIBITOR_NOT_FOUND:    404,
  EXHIBITOR_DUPLICATE:    409,
  STAFF_NOT_FOUND:        404,
  STAFF_DUPLICATE:        409,
  CATEGORY_NOT_FOUND:     404,
  ASSIGNMENT_NOT_FOUND:   404,
};

const DEFAULT_MESSAGES: Record<ExhibitorErrorCode, string> = {
  FLOOR_MAP_NOT_FOUND:    'Floor map not found.',
  FLOOR_MAP_DUPLICATE:    'A floor map with this name already exists for this conference.',
  BOOTH_NOT_FOUND:        'Booth not found.',
  BOOTH_ALREADY_ASSIGNED: 'This booth is already assigned to an exhibitor.',
  BOOTH_NOT_AVAILABLE:    'Booth is not available for assignment.',
  EXHIBITOR_NOT_FOUND:    'Exhibitor not found.',
  EXHIBITOR_DUPLICATE:    'An exhibitor with this company name already exists for this conference.',
  STAFF_NOT_FOUND:        'Staff member not found.',
  STAFF_DUPLICATE:        'A staff member with this email already exists for this exhibitor.',
  CATEGORY_NOT_FOUND:     'Booth category not found.',
  ASSIGNMENT_NOT_FOUND:   'Booth assignment not found.',
};

export class ExhibitorError extends Error {
  public readonly code: ExhibitorErrorCode;
  public readonly statusCode: number;

  constructor(code: ExhibitorErrorCode, message?: string) {
    super(message ?? DEFAULT_MESSAGES[code]);
    this.name = 'ExhibitorError';
    this.code = code;
    this.statusCode = HTTP_STATUS[code];
    Object.setPrototypeOf(this, ExhibitorError.prototype);
  }

  toHttpError() {
    return { error: this.code, message: this.message, statusCode: this.statusCode };
  }
}

export function isExhibitorError(err: unknown): err is ExhibitorError {
  return err instanceof ExhibitorError;
}

/** Returns true when err is a PostgreSQL unique-constraint violation (23505). */
export function isPgUniqueViolation(err: unknown, constraintName?: string): boolean {
  const e = err as { code?: string; constraint?: string };
  if (e?.code !== '23505') return false;
  if (constraintName && e.constraint) return e.constraint.includes(constraintName);
  return true;
}
