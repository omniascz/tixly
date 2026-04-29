export type CinemaErrorCode =
  | 'VENUE_NOT_FOUND'         // 404
  | 'VENUE_DUPLICATE'         // 409
  | 'AUDITORIUM_NOT_FOUND'    // 404
  | 'AUDITORIUM_DUPLICATE'    // 409
  | 'FILM_NOT_FOUND'          // 404
  | 'FILM_DUPLICATE'          // 409
  | 'SCREENING_NOT_FOUND'     // 404
  | 'SCREENING_CONFLICT'      // 409
  | 'SCREENING_CANCELLED'     // 422
  | 'SEAT_NOT_FOUND'          // 404
  | 'SEAT_UNAVAILABLE'        // 409
  | 'PROGRAM_NOT_FOUND'       // 404
  | 'PROGRAM_DUPLICATE'       // 409
  | 'VALIDATION_ERROR';       // 422

const HTTP_STATUS: Record<CinemaErrorCode, number> = {
  VENUE_NOT_FOUND: 404,
  VENUE_DUPLICATE: 409,
  AUDITORIUM_NOT_FOUND: 404,
  AUDITORIUM_DUPLICATE: 409,
  FILM_NOT_FOUND: 404,
  FILM_DUPLICATE: 409,
  SCREENING_NOT_FOUND: 404,
  SCREENING_CONFLICT: 409,
  SCREENING_CANCELLED: 422,
  SEAT_NOT_FOUND: 404,
  SEAT_UNAVAILABLE: 409,
  PROGRAM_NOT_FOUND: 404,
  PROGRAM_DUPLICATE: 409,
  VALIDATION_ERROR: 422,
};

const DEFAULT_MESSAGES: Record<CinemaErrorCode, string> = {
  VENUE_NOT_FOUND: 'Cinema venue not found.',
  VENUE_DUPLICATE: 'A venue with this name already exists for this promoter.',
  AUDITORIUM_NOT_FOUND: 'Auditorium not found.',
  AUDITORIUM_DUPLICATE: 'An auditorium with this name already exists in this venue.',
  FILM_NOT_FOUND: 'Film not found.',
  FILM_DUPLICATE: 'A film with this IMDB ID already exists for this promoter.',
  SCREENING_NOT_FOUND: 'Screening not found.',
  SCREENING_CONFLICT: 'The auditorium is already booked for an overlapping time slot.',
  SCREENING_CANCELLED: 'This screening has been cancelled.',
  SEAT_NOT_FOUND: 'Seat not found.',
  SEAT_UNAVAILABLE: 'This seat is not available for reservation.',
  PROGRAM_NOT_FOUND: 'Program not found.',
  PROGRAM_DUPLICATE: 'A program for this venue and week already exists.',
  VALIDATION_ERROR: 'Validation error.',
};

export class CinemaError extends Error {
  public readonly code: CinemaErrorCode;
  public readonly statusCode: number;

  constructor(code: CinemaErrorCode, message?: string) {
    super(message ?? DEFAULT_MESSAGES[code]);
    this.name = 'CinemaError';
    this.code = code;
    this.statusCode = HTTP_STATUS[code];
    Object.setPrototypeOf(this, CinemaError.prototype);
  }

  toHttpError() {
    return { error: this.code, message: this.message, statusCode: this.statusCode };
  }
}

export function isCinemaError(err: unknown): err is CinemaError {
  return err instanceof CinemaError;
}
