// =============================================================================
// Stripe Payments — Error types
// =============================================================================

export type StripeErrorCode =
  | 'ORDER_NOT_FOUND'            // 404 — objednávka neexistuje
  | 'PAYMENT_INTENT_NOT_FOUND'   // 404 — stripe_payment_intent_id není na objednávce
  | 'ALREADY_PAID'               // 409 — objednávka již zaplacena
  | 'REFUND_EXCEEDS_AMOUNT'      // 422 — refund > původní částka
  | 'INVALID_WEBHOOK_SIGNATURE'  // 401 — podpis neodpovídá nebo replay attack
  | 'STRIPE_API_ERROR'           // 502 — chyba při volání Stripe REST API
  | 'DUPLICATE_EVENT';           // 200 (tichý skip) — idempotency, event již zpracován

const HTTP_STATUS: Record<StripeErrorCode, number> = {
  ORDER_NOT_FOUND:           404,
  PAYMENT_INTENT_NOT_FOUND:  404,
  ALREADY_PAID:              409,
  REFUND_EXCEEDS_AMOUNT:     422,
  INVALID_WEBHOOK_SIGNATURE: 401,
  STRIPE_API_ERROR:          502,
  DUPLICATE_EVENT:           200,
};

const DEFAULT_MESSAGES: Record<StripeErrorCode, string> = {
  ORDER_NOT_FOUND:           'Order not found.',
  PAYMENT_INTENT_NOT_FOUND:  'No Stripe PaymentIntent associated with this order.',
  ALREADY_PAID:              'This order has already been paid.',
  REFUND_EXCEEDS_AMOUNT:     'Refund amount exceeds the original payment amount.',
  INVALID_WEBHOOK_SIGNATURE: 'Webhook signature verification failed.',
  STRIPE_API_ERROR:          'Stripe API returned an error.',
  DUPLICATE_EVENT:           'Stripe event already processed (idempotency).',
};

export class StripeError extends Error {
  public readonly code: StripeErrorCode;
  public readonly statusCode: number;

  constructor(code: StripeErrorCode, message?: string) {
    super(message ?? DEFAULT_MESSAGES[code]);
    this.name = 'StripeError';
    this.code = code;
    this.statusCode = HTTP_STATUS[code];
    Object.setPrototypeOf(this, StripeError.prototype);
  }

  toHttpError() {
    return { error: this.code, message: this.message, statusCode: this.statusCode };
  }
}

export function isStripeError(err: unknown): err is StripeError {
  return err instanceof StripeError;
}
