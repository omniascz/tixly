// ---------------------------------------------------------------------------
// Slot Engine — Error codes
// ---------------------------------------------------------------------------

export type SlotErrorCode =
  | 'RESOURCE_NOT_FOUND'        // 404
  | 'RESOURCE_DUPLICATE'        // 409
  | 'RULE_NOT_FOUND'            // 404
  | 'RULE_CONFLICT'             // 409
  | 'SLOT_NOT_FOUND'            // 404
  | 'SLOT_FULL'                 // 409
  | 'SLOT_CLOSED'               // 409
  | 'SLOT_NOT_AVAILABLE'        // 409
  | 'BOOKING_NOT_FOUND'         // 404
  | 'BOOKING_ALREADY_CANCELLED' // 409
  | 'BOOKING_CANNOT_CANCEL'     // 409
  | 'HOLD_NOT_FOUND'            // 404
  | 'HOLD_EXPIRED'              // 410
  | 'HOLD_CONFLICT'             // 409
  | 'INVALID_DATE_RANGE'        // 400
  | 'ADVANCE_BOOKING_LIMIT'     // 400
  | 'CREDIT_CONSUMPTION_FAILED'; // 402

const HTTP_STATUS: Record<SlotErrorCode, number> = {
  RESOURCE_NOT_FOUND: 404,
  RESOURCE_DUPLICATE: 409,
  RULE_NOT_FOUND: 404,
  RULE_CONFLICT: 409,
  SLOT_NOT_FOUND: 404,
  SLOT_FULL: 409,
  SLOT_CLOSED: 409,
  SLOT_NOT_AVAILABLE: 409,
  BOOKING_NOT_FOUND: 404,
  BOOKING_ALREADY_CANCELLED: 409,
  BOOKING_CANNOT_CANCEL: 409,
  HOLD_NOT_FOUND: 404,
  HOLD_EXPIRED: 410,
  HOLD_CONFLICT: 409,
  INVALID_DATE_RANGE: 400,
  ADVANCE_BOOKING_LIMIT: 400,
  CREDIT_CONSUMPTION_FAILED: 402,
};

const DEFAULT_MESSAGES: Record<SlotErrorCode, string> = {
  RESOURCE_NOT_FOUND: 'Resource not found.',
  RESOURCE_DUPLICATE: 'A resource with this name already exists for this promoter/branch.',
  RULE_NOT_FOUND: 'Availability rule not found.',
  RULE_CONFLICT: 'An availability rule already exists for this resource, day of week, and start time.',
  SLOT_NOT_FOUND: 'Slot not found.',
  SLOT_FULL: 'This slot is fully booked.',
  SLOT_CLOSED: 'This slot is closed.',
  SLOT_NOT_AVAILABLE: 'This slot is not available for booking.',
  BOOKING_NOT_FOUND: 'Booking not found.',
  BOOKING_ALREADY_CANCELLED: 'This booking has already been cancelled.',
  BOOKING_CANNOT_CANCEL: 'This booking cannot be cancelled.',
  HOLD_NOT_FOUND: 'Hold not found.',
  HOLD_EXPIRED: 'The hold has expired.',
  HOLD_CONFLICT: 'A hold already exists for this slot and user.',
  INVALID_DATE_RANGE: 'The provided date range is invalid.',
  ADVANCE_BOOKING_LIMIT: 'Booking exceeds the advance booking limit.',
  CREDIT_CONSUMPTION_FAILED: 'Failed to consume permanentka credit; booking rolled back.',
};

export class SlotError extends Error {
  public readonly code: SlotErrorCode;
  public readonly statusCode: number;

  constructor(code: SlotErrorCode, message?: string) {
    super(message ?? DEFAULT_MESSAGES[code]);
    this.name = 'SlotError';
    this.code = code;
    this.statusCode = HTTP_STATUS[code];
    Object.setPrototypeOf(this, SlotError.prototype);
  }

  toHttpError() {
    return { error: this.code, message: this.message, statusCode: this.statusCode };
  }
}

export function isSlotError(err: unknown): err is SlotError {
  return err instanceof SlotError;
}
