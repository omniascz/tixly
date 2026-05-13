export type StaffErrorCode =
  | 'STAFF_NOT_FOUND'         // 404
  | 'STAFF_EMAIL_DUPLICATE'   // 409
  | 'STAFF_INVALID_ROLE'      // 400
  | 'STAFF_PERMISSION_DENIED' // 403
  | 'STAFF_INACTIVE'          // 409
  | 'SHIFT_NOT_FOUND'                // 404
  | 'SHIFT_OVERLAP'                  // 409
  | 'SHIFT_INVALID_TIME_RANGE'       // 400
  | 'SHIFT_INVALID_STATUS_TRANSITION' // 409
  | 'RECURRING_TEMPLATE_NOT_FOUND'    // 404
  | 'RECURRING_TEMPLATE_INVALID'      // 400
  | 'STAFF_UNAVAILABLE'               // 409 — staff is blocked during this period
  | 'AVAILABILITY_NOT_FOUND'          // 404
  | 'AVAILABILITY_INVALID_RANGE'      // 400
  | 'SWAP_REQUEST_NOT_FOUND'          // 404
  | 'SWAP_REQUEST_INVALID_STATE'      // 409
  | 'OPEN_SHIFT_NOT_FOUND'            // 404
  | 'OPEN_SHIFT_ALREADY_CLAIMED';     // 409

const HTTP_STATUS: Record<StaffErrorCode, number> = {
  STAFF_NOT_FOUND: 404,
  STAFF_EMAIL_DUPLICATE: 409,
  STAFF_INVALID_ROLE: 400,
  STAFF_PERMISSION_DENIED: 403,
  STAFF_INACTIVE: 409,
  SHIFT_NOT_FOUND: 404,
  SHIFT_OVERLAP: 409,
  SHIFT_INVALID_TIME_RANGE: 400,
  SHIFT_INVALID_STATUS_TRANSITION: 409,
  RECURRING_TEMPLATE_NOT_FOUND: 404,
  RECURRING_TEMPLATE_INVALID: 400,
  STAFF_UNAVAILABLE: 409,
  AVAILABILITY_NOT_FOUND: 404,
  AVAILABILITY_INVALID_RANGE: 400,
  SWAP_REQUEST_NOT_FOUND: 404,
  SWAP_REQUEST_INVALID_STATE: 409,
  OPEN_SHIFT_NOT_FOUND: 404,
  OPEN_SHIFT_ALREADY_CLAIMED: 409,
};

const DEFAULT_MESSAGES: Record<StaffErrorCode, string> = {
  STAFF_NOT_FOUND: 'Zaměstnanec nebyl nalezen.',
  STAFF_EMAIL_DUPLICATE: 'Zaměstnanec s tímto e-mailem již existuje.',
  STAFF_INVALID_ROLE: 'Neplatná role zaměstnance.',
  STAFF_PERMISSION_DENIED: 'Nedostatečná oprávnění.',
  STAFF_INACTIVE: 'Zaměstnanec není aktivní.',
  SHIFT_NOT_FOUND: 'Směna nebyla nalezena.',
  SHIFT_OVERLAP: 'Zaměstnanec již má v tomto čase přidělenou jinou směnu.',
  SHIFT_INVALID_TIME_RANGE: 'Neplatný časový rozsah směny.',
  SHIFT_INVALID_STATUS_TRANSITION: 'Nepovolená změna stavu směny.',
  RECURRING_TEMPLATE_NOT_FOUND: 'Opakující se šablona nebyla nalezena.',
  RECURRING_TEMPLATE_INVALID: 'Neplatná opakující se šablona směny.',
  STAFF_UNAVAILABLE: 'Zaměstnanec je v tomto období nedostupný (dovolená, nemoc, …).',
  AVAILABILITY_NOT_FOUND: 'Záznam o nedostupnosti nebyl nalezen.',
  AVAILABILITY_INVALID_RANGE: 'Neplatný časový rozsah nedostupnosti.',
  SWAP_REQUEST_NOT_FOUND: 'Žádost o výměnu směny nebyla nalezena.',
  SWAP_REQUEST_INVALID_STATE: 'Žádost o výměnu směny je v neplatném stavu pro tuto operaci.',
  OPEN_SHIFT_NOT_FOUND: 'Otevřená směna nebyla nalezena.',
  OPEN_SHIFT_ALREADY_CLAIMED: 'Otevřená směna již byla obsazena.',
};

export interface HttpError {
  error: StaffErrorCode;
  message: string;
  statusCode: number;
}

export class StaffError extends Error {
  public readonly code: StaffErrorCode;
  public readonly statusCode: number;

  constructor(code: StaffErrorCode, message?: string) {
    super(message ?? DEFAULT_MESSAGES[code]);
    this.name = 'StaffError';
    this.code = code;
    this.statusCode = HTTP_STATUS[code];
    Object.setPrototypeOf(this, StaffError.prototype);
  }

  toHttpError(): HttpError {
    return {
      error: this.code,
      message: this.message,
      statusCode: this.statusCode,
    };
  }
}

export function isStaffError(err: unknown): err is StaffError {
  return err instanceof StaffError;
}
