// Installment payments — domain types
// All monetary amounts are in haléře (CZK cents).

// ---------------------------------------------------------------------------
// Core domain types
// ---------------------------------------------------------------------------

export interface InstallmentPlan {
  id: string;
  ticket_type_id: string;
  /** Number of installments the buyer will pay */
  num_installments: 2 | 3 | 4;
  interval: 'weekly' | 'monthly';
  /**
   * Percentage of total price charged as the first installment.
   * Default: 50 for 2, 34 for 3, 25 for 4.
   */
  first_installment_pct: number;
  active: boolean;
}

export interface InstallmentSchedule {
  id: string;
  order_id: string;
  ticket_id: string;
  user_id: string;
  plan_id: string;
  /** Total ticket price in haléře */
  total_amount: number;
  installments: InstallmentPayment[];
  status: 'active' | 'completed' | 'cancelled' | 'failed';
  /** GoPay recurrence token stored after the first (initial) payment */
  gopay_recurrence_token: string;
  created_at: Date;
}

export interface InstallmentPayment {
  id: string;
  schedule_id: string;
  /** 1-based index: 1 = first (paid at purchase), 2..N = automatic */
  installment_number: number;
  /** Amount in haléře */
  amount: number;
  due_date: Date;
  paid_at: Date | null;
  gopay_payment_id: string | null;
  status: 'pending' | 'paid' | 'failed' | 'retrying';
  /** How many automatic retry attempts have been made (0–3) */
  retry_count: number;
  last_retry_at: Date | null;
}

// ---------------------------------------------------------------------------
// Typed errors
// ---------------------------------------------------------------------------

abstract class InstallmentError extends Error {
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

export class InstallmentPlanNotFoundError extends InstallmentError {
  readonly statusCode = 404;
  readonly code = 'INSTALLMENT_PLAN_NOT_FOUND';
}

export class InstallmentScheduleNotFoundError extends InstallmentError {
  readonly statusCode = 404;
  readonly code = 'INSTALLMENT_SCHEDULE_NOT_FOUND';
}

export class InstallmentPaymentFailedError extends InstallmentError {
  readonly statusCode = 422;
  readonly code = 'INSTALLMENT_PAYMENT_FAILED';
  readonly retry_count: number;

  constructor(message: string, retryCount: number) {
    super(message);
    this.retry_count = retryCount;
  }
}

/** The user already has an active installment schedule for this ticket */
export class InstallmentAlreadyActiveError extends InstallmentError {
  readonly statusCode = 409;
  readonly code = 'INSTALLMENT_ALREADY_ACTIVE';
}

/** The ticket type does not have installments configured */
export class InstallmentNotSupportedError extends InstallmentError {
  readonly statusCode = 422;
  readonly code = 'INSTALLMENT_NOT_SUPPORTED';
}

export class NoPendingInstallmentsError extends InstallmentError {
  readonly statusCode = 422;
  readonly code = 'NO_PENDING_INSTALLMENTS';
}

// ---------------------------------------------------------------------------
// HTTP error mapping helper
// ---------------------------------------------------------------------------

export function toInstallmentHttpError(err: unknown): {
  status: number;
  body: { error: string; code: string };
} {
  if (err instanceof InstallmentError) {
    return {
      status: err.statusCode,
      body: { error: err.message, code: err.code },
    };
  }
  console.error('[installments] Unhandled error:', err);
  return {
    status: 500,
    body: { error: 'Internal server error', code: 'INTERNAL_ERROR' },
  };
}
