// ---------------------------------------------------------------------------
// Packages v2 — Error codes
// ---------------------------------------------------------------------------

export type PackageErrorCode =
  | 'PACKAGE_NOT_FOUND'        // 404
  | 'PACKAGE_DUPLICATE'        // 409
  | 'PACKAGE_SOLD_OUT'         // 409
  | 'PACKAGE_SALE_CLOSED'      // 422
  | 'PACKAGE_EXPIRED'          // 422
  | 'ITEM_NOT_FOUND'           // 404
  | 'PURCHASE_NOT_FOUND'       // 404
  | 'PURCHASE_EXPIRED'         // 422
  | 'PURCHASE_FULLY_USED'      // 422
  | 'PURCHASE_CANCELLED'       // 422
  | 'ITEM_QUOTA_EXCEEDED'      // 422
  | 'INSUFFICIENT_CREDITS'     // 422
  | 'TRANSFER_NOT_ALLOWED'     // 422
  | 'TRANSFER_TOKEN_INVALID';  // 404

const HTTP_STATUS: Record<PackageErrorCode, number> = {
  PACKAGE_NOT_FOUND: 404,
  PACKAGE_DUPLICATE: 409,
  PACKAGE_SOLD_OUT: 409,
  PACKAGE_SALE_CLOSED: 422,
  PACKAGE_EXPIRED: 422,
  ITEM_NOT_FOUND: 404,
  PURCHASE_NOT_FOUND: 404,
  PURCHASE_EXPIRED: 422,
  PURCHASE_FULLY_USED: 422,
  PURCHASE_CANCELLED: 422,
  ITEM_QUOTA_EXCEEDED: 422,
  INSUFFICIENT_CREDITS: 422,
  TRANSFER_NOT_ALLOWED: 422,
  TRANSFER_TOKEN_INVALID: 404,
};

const DEFAULT_MESSAGES: Record<PackageErrorCode, string> = {
  PACKAGE_NOT_FOUND: 'Package not found.',
  PACKAGE_DUPLICATE: 'A package with this slug already exists for this promoter.',
  PACKAGE_SOLD_OUT: 'This package is sold out.',
  PACKAGE_SALE_CLOSED: 'This package is not available for sale at this time.',
  PACKAGE_EXPIRED: 'This package has expired.',
  ITEM_NOT_FOUND: 'Package item not found.',
  PURCHASE_NOT_FOUND: 'Purchase not found.',
  PURCHASE_EXPIRED: 'This purchase has expired.',
  PURCHASE_FULLY_USED: 'This purchase has been fully used.',
  PURCHASE_CANCELLED: 'This purchase has been cancelled.',
  ITEM_QUOTA_EXCEEDED: 'Item usage quota exceeded.',
  INSUFFICIENT_CREDITS: 'Insufficient credit balance.',
  TRANSFER_NOT_ALLOWED: 'This package cannot be transferred.',
  TRANSFER_TOKEN_INVALID: 'Transfer token is invalid or has already been used.',
};

export class PackageError extends Error {
  public readonly code: PackageErrorCode;
  public readonly statusCode: number;

  constructor(code: PackageErrorCode, message?: string) {
    super(message ?? DEFAULT_MESSAGES[code]);
    this.name = 'PackageError';
    this.code = code;
    this.statusCode = HTTP_STATUS[code];
    Object.setPrototypeOf(this, PackageError.prototype);
  }

  toHttpError() {
    return { error: this.code, message: this.message, statusCode: this.statusCode };
  }
}

export function isPackageError(err: unknown): err is PackageError {
  return err instanceof PackageError;
}
