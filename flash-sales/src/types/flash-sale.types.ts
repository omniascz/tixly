// Flash sale domain types
// All monetary values are in haléře (1 CZK = 100 haléřů)

export type FlashSaleStatus = 'scheduled' | 'active' | 'ended' | 'cancelled';
export type DiscountType = 'percentage' | 'fixed';

export interface FlashSale {
  id: string;
  event_id: string;
  ticket_type_id: string;
  /** Display name, e.g. "48h Flash Sale — 30 % sleva" */
  name: string;
  discount_type: DiscountType;
  /** Percentage (0–100) or fixed amount in haléře */
  discount_value: number;
  /** Total number of tickets available at the flash price */
  flash_capacity: number;
  /** Number of tickets already sold at flash price */
  flash_sold_count: number;
  /** Snapshot of original_price at the time the flash sale was created (haléře) */
  original_price: number;
  /** Computed flash price in haléře — readonly, calculated at creation */
  flash_price: number;
  starts_at: Date;
  ends_at: Date;
  status: FlashSaleStatus;
  created_by_organizer_id: string;
  created_at: Date;
}

/** What a buyer sees — no internal fields */
export interface FlashSalePublicView {
  id: string;
  name: string;
  flash_price: number;
  original_price: number;
  /** Always expressed as a percentage for display purposes */
  discount_pct: number;
  /** Remaining flash-price tickets */
  remaining_count: number;
  ends_at: Date;
  /** Seconds until ends_at; min 0 */
  seconds_remaining: number;
  status: 'active' | 'ended' | 'sold_out';
}

// ---------------------------------------------------------------------------
// Typed domain errors
// ---------------------------------------------------------------------------

abstract class FlashSaleBaseError extends Error {
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

/** 404 — Flash sale not found for the given ID */
export class FlashSaleNotFoundError extends FlashSaleBaseError {
  readonly statusCode = 404;
  readonly code = 'FLASH_SALE_NOT_FOUND';
}

/** 409 — Flash sale is not in 'active' status */
export class FlashSaleNotActiveError extends FlashSaleBaseError {
  readonly statusCode = 409;
  readonly code = 'FLASH_SALE_NOT_ACTIVE';
}

/** 409 — All flash-price tickets have been sold */
export class FlashSaleCapacityExhaustedError extends FlashSaleBaseError {
  readonly statusCode = 409;
  readonly code = 'FLASH_SALE_CAPACITY_EXHAUSTED';
}

/** 409 — Another flash sale for the same ticket_type is already active or scheduled */
export class FlashSaleOverlapError extends FlashSaleBaseError {
  readonly statusCode = 409;
  readonly code = 'FLASH_SALE_OVERLAP';
}

/** 422 — ends_at <= starts_at, or starts_at is in the past */
export class FlashSaleInvalidTimeError extends FlashSaleBaseError {
  readonly statusCode = 422;
  readonly code = 'FLASH_SALE_INVALID_TIME';
}

/** 403 — Authenticated organizer does not own this ticket type */
export class FlashSaleUnauthorizedError extends FlashSaleBaseError {
  readonly statusCode = 403;
  readonly code = 'FLASH_SALE_UNAUTHORIZED';
}

// ---------------------------------------------------------------------------
// HTTP error mapping helper — used by all API route handlers
// ---------------------------------------------------------------------------

export type FlashSaleError =
  | FlashSaleNotFoundError
  | FlashSaleNotActiveError
  | FlashSaleCapacityExhaustedError
  | FlashSaleOverlapError
  | FlashSaleInvalidTimeError
  | FlashSaleUnauthorizedError;

function isFlashSaleError(err: unknown): err is FlashSaleBaseError {
  return err instanceof FlashSaleBaseError;
}

export function toHttpError(err: unknown): {
  status: number;
  body: { error: string; code: string };
} {
  if (isFlashSaleError(err)) {
    return {
      status: err.statusCode,
      body: { error: err.message, code: err.code },
    };
  }
  console.error('[flash-sale] Unhandled error:', err);
  return {
    status: 500,
    body: { error: 'Internal server error', code: 'INTERNAL_ERROR' },
  };
}
