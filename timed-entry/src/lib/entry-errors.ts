export type EntryErrorCode =
  | 'VENUE_NOT_FOUND'        // 404
  | 'VENUE_DUPLICATE'        // 409
  | 'ZONE_NOT_FOUND'         // 404
  | 'ZONE_DUPLICATE'         // 409
  | 'TICKET_TYPE_NOT_FOUND'  // 404
  | 'SLOT_NOT_FOUND'         // 404
  | 'SLOT_FULL'              // 409
  | 'SLOT_CLOSED'            // 409
  | 'BOOKING_NOT_FOUND'      // 404
  | 'BOOKING_DUPLICATE'      // 409
  | 'BOOKING_ALREADY_USED'   // 409
  | 'BOOKING_CANCELLED'      // 409
  | 'QR_TOKEN_INVALID';      // 404

const HTTP_STATUS: Record<EntryErrorCode, number> = {
  VENUE_NOT_FOUND: 404,
  VENUE_DUPLICATE: 409,
  ZONE_NOT_FOUND: 404,
  ZONE_DUPLICATE: 409,
  TICKET_TYPE_NOT_FOUND: 404,
  SLOT_NOT_FOUND: 404,
  SLOT_FULL: 409,
  SLOT_CLOSED: 409,
  BOOKING_NOT_FOUND: 404,
  BOOKING_DUPLICATE: 409,
  BOOKING_ALREADY_USED: 409,
  BOOKING_CANCELLED: 409,
  QR_TOKEN_INVALID: 404,
};

const DEFAULT_MESSAGES: Record<EntryErrorCode, string> = {
  VENUE_NOT_FOUND: 'Venue not found.',
  VENUE_DUPLICATE: 'A venue with this name already exists for this promoter.',
  ZONE_NOT_FOUND: 'Zone not found.',
  ZONE_DUPLICATE: 'A zone with this name already exists for this venue.',
  TICKET_TYPE_NOT_FOUND: 'Ticket type not found.',
  SLOT_NOT_FOUND: 'Entry slot not found.',
  SLOT_FULL: 'Entry slot is fully booked.',
  SLOT_CLOSED: 'Entry slot is closed or unavailable.',
  BOOKING_NOT_FOUND: 'Booking not found.',
  BOOKING_DUPLICATE: 'A booking already exists for this user and slot.',
  BOOKING_ALREADY_USED: 'This booking has already been used for check-in.',
  BOOKING_CANCELLED: 'This booking has been cancelled.',
  QR_TOKEN_INVALID: 'QR token is invalid or not found.',
};

export class EntryError extends Error {
  public readonly code: EntryErrorCode;
  public readonly statusCode: number;

  constructor(code: EntryErrorCode, message?: string) {
    super(message ?? DEFAULT_MESSAGES[code]);
    this.name = 'EntryError';
    this.code = code;
    this.statusCode = HTTP_STATUS[code];
    Object.setPrototypeOf(this, EntryError.prototype);
  }

  toHttpError() {
    return { error: this.code, message: this.message, statusCode: this.statusCode };
  }
}

export function isEntryError(err: unknown): err is EntryError {
  return err instanceof EntryError;
}
