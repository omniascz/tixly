// Gift voucher domain types — Tixly
// All monetary values are in subunits (haléře for CZK, cents for EUR/USD, etc.).

// ---------------------------------------------------------------------------
// Enums / union types
// ---------------------------------------------------------------------------

export type GiftVoucherType = 'value' | 'event_specific' | 'ticket';

export type GiftVoucherStatus = 'issued' | 'sent' | 'redeemed' | 'expired' | 'cancelled';

// ---------------------------------------------------------------------------
// Core entity
// ---------------------------------------------------------------------------

export interface GiftVoucher {
  id: string;
  /** 16-character code, format XXXX-XXXX-XXXX-XXXX (uppercase letters + digits, no O/0/I/1) */
  code: string;
  type: GiftVoucherType;
  status: GiftVoucherStatus;
  /** Haléře. For ticket type: face value of the ticket at issuance time. */
  initial_value: number;
  /** Haléře. Decremented on partial redemption; 0 when fully redeemed. */
  remaining_value: number;
  /** ISO 4217 currency code — inherited from event or platform default */
  currency: string;
  purchaser_user_id: string;
  recipient_email: string | null;
  recipient_name: string | null;
  /** Only set for event_specific vouchers */
  applicable_event_id: string | null;
  /** Only set for ticket vouchers */
  applicable_ticket_type_id: string | null;
  /** Default: issued_at + 12 months */
  valid_until: Date;
  issued_at: Date;
  sent_at: Date | null;
  redeemed_at: Date | null;
  redemption_order_id: string | null;
  /** Gift message from purchaser, max 280 characters */
  personal_message: string | null;
}

// ---------------------------------------------------------------------------
// Request / response shapes
// ---------------------------------------------------------------------------

export interface RedeemVoucherRequest {
  code: string;
  order_items: Array<{
    ticket_type_id: string;
    event_id: string;
    quantity: number;
    unit_price: number;
  }>;
  user_id: string;
}

export interface RedeemVoucherResult {
  voucher_id: string;
  code: string;
  /** Haléře subtracted from the voucher's remaining_value */
  applied_amount: number;
  /** Haléře remaining on the voucher after this redemption */
  remaining_value: number;
  fully_redeemed: boolean;
  new_status: GiftVoucherStatus;
}

// ---------------------------------------------------------------------------
// Typed errors
// ---------------------------------------------------------------------------

abstract class VoucherError extends Error {
  abstract readonly statusCode: number;
  abstract readonly code: string;

  constructor(message: string) {
    super(message);
    this.name = this.constructor.name;
    if (Error.captureStackTrace) {
      Error.captureStackTrace(this, this.constructor);
    }
  }
}

export class VoucherNotFoundError extends VoucherError {
  readonly statusCode = 404;
  readonly code = 'VOUCHER_NOT_FOUND';
}

export class VoucherExpiredError extends VoucherError {
  readonly statusCode = 410;
  readonly code = 'VOUCHER_EXPIRED';
}

export class VoucherAlreadyRedeemedError extends VoucherError {
  readonly statusCode = 409;
  readonly code = 'VOUCHER_ALREADY_REDEEMED';
}

export class VoucherCancelledError extends VoucherError {
  readonly statusCode = 409;
  readonly code = 'VOUCHER_CANCELLED';
}

/** Voucher type is event_specific or ticket and the order items do not match */
export class VoucherNotApplicableError extends VoucherError {
  readonly statusCode = 422;
  readonly code = 'VOUCHER_NOT_APPLICABLE';
}

/** remaining_value is already 0 */
export class VoucherInsufficientValueError extends VoucherError {
  readonly statusCode = 422;
  readonly code = 'VOUCHER_INSUFFICIENT_VALUE';
}

export class VoucherUnauthorizedError extends VoucherError {
  readonly statusCode = 403;
  readonly code = 'VOUCHER_UNAUTHORIZED';
}

// ---------------------------------------------------------------------------
// HTTP error mapping helper
// ---------------------------------------------------------------------------

export function voucherErrorToHttp(err: unknown): { status: number; body: { error: string; code: string } } {
  if (err instanceof VoucherError) {
    return { status: err.statusCode, body: { error: err.message, code: err.code } };
  }
  console.error('[gift-vouchers] Unhandled error:', err);
  return { status: 500, body: { error: 'Internal server error', code: 'INTERNAL_ERROR' } };
}
