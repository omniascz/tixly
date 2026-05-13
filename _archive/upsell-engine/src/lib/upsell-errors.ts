export type UpsellErrorCode =
  | 'ORDER_NOT_FOUND'
  | 'UPSELL_NOT_FOUND'
  | 'UPSELL_SOLD_OUT'
  | 'UPSELL_NOT_AVAILABLE'
  | 'MAX_PER_ORDER_EXCEEDED'
  | 'DUPLICATE_UPSELL'
  | 'TIME_WINDOW_CLOSED'
  | 'UNAUTHORIZED'
  | 'EVENT_NOT_FOUND'
  | 'VIP_NOT_AVAILABLE'
  | 'VIP_UPGRADE_NO_SURCHARGE';

export class UpsellError extends Error {
  constructor(
    public readonly code: UpsellErrorCode,
    message: string,
    public readonly statusCode: number,
  ) {
    super(message);
    this.name = 'UpsellError';
    Object.setPrototypeOf(this, new.target.prototype);
  }

  toHttpError(): { error: { code: UpsellErrorCode; message: string } } {
    return { error: { code: this.code, message: this.message } };
  }
}

export const ERROR_STATUS_MAP: Record<UpsellErrorCode, number> = {
  ORDER_NOT_FOUND: 404,
  UPSELL_NOT_FOUND: 404,
  UPSELL_SOLD_OUT: 409,
  UPSELL_NOT_AVAILABLE: 422,
  MAX_PER_ORDER_EXCEEDED: 422,
  DUPLICATE_UPSELL: 409,
  TIME_WINDOW_CLOSED: 422,
  UNAUTHORIZED: 403,
  EVENT_NOT_FOUND: 404,
  VIP_NOT_AVAILABLE: 422,
  VIP_UPGRADE_NO_SURCHARGE: 422,
};
