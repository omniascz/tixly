export type MerchandiseErrorCode =
  | 'PRODUCT_NOT_FOUND'
  | 'VARIANT_NOT_FOUND'
  | 'VARIANT_SOLD_OUT'
  | 'INSUFFICIENT_STOCK'
  | 'ORDER_NOT_FOUND'
  | 'ORDER_ITEM_NOT_FOUND'
  | 'DUPLICATE_ORDER'
  | 'UNAUTHORIZED'
  | 'SHIPPING_REQUIRED'
  | 'CANCEL_NOT_ALLOWED'
  | 'INVALID_QUANTITY';

const STATUS_MAP: Record<MerchandiseErrorCode, number> = {
  PRODUCT_NOT_FOUND: 404,
  VARIANT_NOT_FOUND: 404,
  VARIANT_SOLD_OUT: 409,
  INSUFFICIENT_STOCK: 409,
  ORDER_NOT_FOUND: 404,
  ORDER_ITEM_NOT_FOUND: 404,
  DUPLICATE_ORDER: 409,
  UNAUTHORIZED: 404,         // anti-enumeration: 404 not 403
  SHIPPING_REQUIRED: 422,
  CANCEL_NOT_ALLOWED: 422,
  INVALID_QUANTITY: 422,
};

export interface HttpError {
  statusCode: number;
  code: MerchandiseErrorCode;
  message: string;
}

export class MerchandiseError extends Error {
  readonly statusCode: number;
  readonly code: MerchandiseErrorCode;

  constructor(code: MerchandiseErrorCode, message?: string) {
    super(message ?? code);
    this.name = 'MerchandiseError';
    this.code = code;
    this.statusCode = STATUS_MAP[code];
    Object.setPrototypeOf(this, MerchandiseError.prototype);
  }

  toHttpError(): HttpError {
    return {
      statusCode: this.statusCode,
      code: this.code,
      message: this.message,
    };
  }
}

export function isMerchandiseError(err: unknown): err is MerchandiseError {
  return err instanceof MerchandiseError;
}
