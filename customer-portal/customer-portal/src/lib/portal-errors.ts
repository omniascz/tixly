// ---------------------------------------------------------------------------
// Customer Portal — Error codes
// ---------------------------------------------------------------------------

export type PortalErrorCode =
  | 'PROFILE_NOT_FOUND'           // 404
  | 'PROFILE_DUPLICATE'           // 409
  | 'RECEIPT_NOT_FOUND'           // 404
  | 'WAITLIST_ENTRY_NOT_FOUND'    // 404
  | 'WAITLIST_DUPLICATE'          // 409
  | 'WAITLIST_SLOT_NOW_AVAILABLE' // 200 informational
  | 'NOT_ON_WAITLIST'             // 404
  | 'FAVORITE_NOT_FOUND';         // 404

const HTTP_STATUS: Record<PortalErrorCode, number> = {
  PROFILE_NOT_FOUND: 404,
  PROFILE_DUPLICATE: 409,
  RECEIPT_NOT_FOUND: 404,
  WAITLIST_ENTRY_NOT_FOUND: 404,
  WAITLIST_DUPLICATE: 409,
  WAITLIST_SLOT_NOW_AVAILABLE: 200,
  NOT_ON_WAITLIST: 404,
  FAVORITE_NOT_FOUND: 404,
};

const DEFAULT_MESSAGES: Record<PortalErrorCode, string> = {
  PROFILE_NOT_FOUND: 'Customer profile not found.',
  PROFILE_DUPLICATE: 'A profile for this user and promoter already exists.',
  RECEIPT_NOT_FOUND: 'Receipt not found.',
  WAITLIST_ENTRY_NOT_FOUND: 'Waitlist entry not found.',
  WAITLIST_DUPLICATE: 'User is already on the waitlist for this slot.',
  WAITLIST_SLOT_NOW_AVAILABLE: 'Slot is now available.',
  NOT_ON_WAITLIST: 'User is not on the waitlist for this slot.',
  FAVORITE_NOT_FOUND: 'Favorite not found.',
};

export class PortalError extends Error {
  public readonly code: PortalErrorCode;
  public readonly statusCode: number;

  constructor(code: PortalErrorCode, message?: string) {
    super(message ?? DEFAULT_MESSAGES[code]);
    this.name = 'PortalError';
    this.code = code;
    this.statusCode = HTTP_STATUS[code];
    Object.setPrototypeOf(this, PortalError.prototype);
  }

  toHttpError() {
    return { error: this.code, message: this.message, statusCode: this.statusCode };
  }
}

export function isPortalError(err: unknown): err is PortalError {
  return err instanceof PortalError;
}
