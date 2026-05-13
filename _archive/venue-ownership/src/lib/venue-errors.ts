export type VenueErrorCode =
  | 'VENUE_NOT_FOUND'        // 404
  | 'VENUE_SLUG_TAKEN'       // 409
  | 'VENUE_ACCESS_DENIED'    // 404 (anti-enumeration)
  | 'VENUE_NOT_EDITABLE'     // 403 — public venue cannot be edited by owner (admin only)
  | 'VENUE_HAS_EVENTS'       // 422 — venue has scheduled events, cannot delete
  | 'INVALID_CAPACITY'       // 422
  | 'UNAUTHORIZED';          // 401 mapped to 404 for anti-enumeration

const STATUS_MAP: Record<VenueErrorCode, number> = {
  VENUE_NOT_FOUND: 404,
  VENUE_SLUG_TAKEN: 409,
  VENUE_ACCESS_DENIED: 404,
  VENUE_NOT_EDITABLE: 403,
  VENUE_HAS_EVENTS: 422,
  INVALID_CAPACITY: 422,
  UNAUTHORIZED: 404,
};

export class VenueError extends Error {
  readonly code: VenueErrorCode;
  readonly statusCode: number;
  readonly details?: Record<string, unknown>;

  constructor(
    code: VenueErrorCode,
    message?: string,
    details?: Record<string, unknown>,
  ) {
    super(message ?? code);
    this.name = 'VenueError';
    this.code = code;
    this.statusCode = STATUS_MAP[code];
    this.details = details;
  }

  toHttpError(): { error: { code: VenueErrorCode; message: string; details?: Record<string, unknown> } } {
    return {
      error: {
        code: this.code,
        message: this.message,
        ...(this.details !== undefined ? { details: this.details } : {}),
      },
    };
  }
}
