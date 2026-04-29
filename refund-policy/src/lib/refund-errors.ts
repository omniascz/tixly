export type RefundErrorCode =
  | 'POLICY_NOT_FOUND'          // 404
  | 'REQUEST_NOT_FOUND'         // 404
  | 'ORDER_NOT_FOUND'           // 404
  | 'REFUND_NOT_ELIGIBLE'       // 422 — order nesplňuje podmínky policy
  | 'REFUND_WINDOW_EXPIRED'     // 422 — po termínu
  | 'ALREADY_REFUNDED'          // 409 — order/ticket již refundován
  | 'SELF_SERVICE_NOT_ALLOWED'  // 422 — policy vyžaduje žádost přes support
  | 'NO_REFUND_POLICY'          // 422 — politika = no_refund
  | 'REQUEST_ALREADY_DECIDED'   // 409 — žádost již rozhodnuta
  | 'INVALID_AMOUNT'            // 422 — amount > max eligible
  | 'DUPLICATE_REQUEST'         // 409 — idempotency key
  | 'BULK_REFUND_PARTIAL_FAILURE' // 500 — some orders failed during bulk
  | 'REFUND_ALREADY_PROCESSED'  // 409 — refund already approved or processed
  | 'UNAUTHORIZED';             // 403

const HTTP_STATUS: Record<RefundErrorCode, number> = {
  POLICY_NOT_FOUND: 404,
  REQUEST_NOT_FOUND: 404,
  ORDER_NOT_FOUND: 404,
  REFUND_NOT_ELIGIBLE: 422,
  REFUND_WINDOW_EXPIRED: 422,
  ALREADY_REFUNDED: 409,
  SELF_SERVICE_NOT_ALLOWED: 422,
  NO_REFUND_POLICY: 422,
  REQUEST_ALREADY_DECIDED: 409,
  INVALID_AMOUNT: 422,
  DUPLICATE_REQUEST: 409,
  BULK_REFUND_PARTIAL_FAILURE: 500,
  REFUND_ALREADY_PROCESSED: 409,
  UNAUTHORIZED: 404,
};

export class RefundError extends Error {
  public readonly code: RefundErrorCode;
  public readonly statusCode: number;

  constructor(code: RefundErrorCode, message?: string) {
    super(message ?? code);
    this.name = 'RefundError';
    this.code = code;
    this.statusCode = HTTP_STATUS[code];
    Object.setPrototypeOf(this, RefundError.prototype);
  }

  toHttpError(): { error: { code: RefundErrorCode; message: string } } {
    return {
      error: {
        code: this.code,
        message: this.message,
      },
    };
  }
}

export function isRefundError(err: unknown): err is RefundError {
  return err instanceof RefundError;
}
