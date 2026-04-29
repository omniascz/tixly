// Custom error hierarchy for the resale marketplace.
// Each error carries an HTTP status code so API route handlers can map
// them to the correct response without a chain of instanceof checks.

export abstract class ResaleError extends Error {
  abstract readonly statusCode: number;
  abstract readonly code: string;

  constructor(message: string) {
    super(message);
    this.name = this.constructor.name;
    // Maintain proper stack trace in V8
    if (Error.captureStackTrace) {
      Error.captureStackTrace(this, this.constructor);
    }
  }
}

/** 409 — Listing was already reserved or sold by the time buyer tried to purchase */
export class ListingUnavailableError extends ResaleError {
  readonly statusCode = 409;
  readonly code = 'LISTING_UNAVAILABLE';
}

/** 404 — No listing found for the given ID */
export class ListingNotFoundError extends ResaleError {
  readonly statusCode = 404;
  readonly code = 'LISTING_NOT_FOUND';
}

/** 403 — Authenticated user is not the seller of this listing / ticket */
export class UnauthorizedSellerError extends ResaleError {
  readonly statusCode = 403;
  readonly code = 'UNAUTHORIZED_SELLER';
}

/** 403 — The event's organiser has disabled resale for this event */
export class ResaleNotAllowedError extends ResaleError {
  readonly statusCode = 403;
  readonly code = 'RESALE_NOT_ALLOWED';
}

/** 422 — ask_price exceeds 110 % of face value (EU price cap) */
export class PriceCapViolationError extends ResaleError {
  readonly statusCode = 422;
  readonly code = 'PRICE_CAP_VIOLATION';

  constructor(askPrice: number, capHalire: number) {
    super(
      `ask_price ${askPrice} exceeds the EU resale price cap of ${capHalire} (110 % of face value). Directive 2019/771.`,
    );
  }
}

/**
 * 422 — ask_price is below 50 % of original_price.
 * Auto-blocked as a potential side-payment / fraud signal.
 */
export class FraudSuspectedError extends ResaleError {
  readonly statusCode = 422;
  readonly code = 'FRAUD_SUSPECTED';

  constructor(askPrice: number, originalPrice: number) {
    super(
      `ask_price ${askPrice} is below 50 % of original_price ${originalPrice}. Listing blocked pending manual review.`,
    );
  }
}

/** 410 — Buyer did not claim the ticket within the 4-hour claim window */
export class ClaimWindowExpiredError extends ResaleError {
  readonly statusCode = 410;
  readonly code = 'CLAIM_WINDOW_EXPIRED';
}

/** 422 — Buyer and seller are the same user */
export class SelfPurchaseError extends ResaleError {
  readonly statusCode = 422;
  readonly code = 'SELF_PURCHASE';
}

/** 409 — Active listing already exists for this ticket (partial-unique index) */
export class DuplicateListingError extends ResaleError {
  readonly statusCode = 409;
  readonly code = 'DUPLICATE_LISTING';
}

/** 422 — Ticket status is not 'valid' and therefore cannot be listed */
export class TicketNotValidError extends ResaleError {
  readonly statusCode = 422;
  readonly code = 'TICKET_NOT_VALID';
}

/** 422 — Ticket does not belong to the authenticated user */
export class TicketOwnershipError extends ResaleError {
  readonly statusCode = 422;
  readonly code = 'TICKET_OWNERSHIP_ERROR';
}

/** 409 — Event starts in less than 24h; resale listing can no longer be created */
export class EventTooSoonError extends ResaleError {
  readonly statusCode = 409;
  readonly code = 'EVENT_TOO_SOON';

  constructor(hoursUntilEvent: number) {
    super(
      `Event začíná za ${hoursUntilEvent}h — resale listing už nelze vytvořit (min. 24h předem).`,
    );
  }
}

/** 400 — GoPay webhook signature validation failed */
export class InvalidWebhookSignatureError extends ResaleError {
  readonly statusCode = 400;
  readonly code = 'INVALID_WEBHOOK_SIGNATURE';
}

/**
 * 409 — Pokus o uvolnění escrow, který není ve stavu 'held'.
 * Typicky to znamená, že escrow byl už dříve uvolněn (idempotent gate scan)
 * nebo vstupenka vůbec nepochází z resale (žádný listing).
 */
export class EscrowNotHeldError extends ResaleError {
  readonly statusCode = 409;
  readonly code = 'ESCROW_NOT_HELD';

  constructor(currentStatus: string) {
    super(
      `Escrow nelze uvolnit — aktuální stav je '${currentStatus}', očekáván 'held'.`,
    );
  }
}

/**
 * 500 — TOTP rotace selhala uvnitř transakce (např. chybí ticket, chyba šifrování,
 * selhání INSERT do ticket_transfer_log). Vyvolává rollback celé resale transakce.
 */
export class TotpRotationFailedError extends ResaleError {
  readonly statusCode = 500;
  readonly code = 'TOTP_ROTATION_FAILED';

  constructor(ticketId: string, reason: string) {
    super(`TOTP rotace pro vstupenku ${ticketId} selhala: ${reason}`);
  }
}

// ---------------------------------------------------------------------------
// Feature #49 — Daruju vstupenku (gift transfer)
// ---------------------------------------------------------------------------

/** 404 — Příjemce s tímto e-mailem není v systému zaregistrován */
export class RecipientNotFoundError extends ResaleError {
  readonly statusCode = 404;
  readonly code = 'RECIPIENT_NOT_FOUND';

  constructor(email: string) {
    super(`Příjemce s e-mailem '${email}' není zaregistrován.`);
  }
}

/** 400 — Pokus darovat vstupenku sám sobě */
export class SelfTransferError extends ResaleError {
  readonly statusCode = 400;
  readonly code = 'SELF_TRANSFER';

  constructor() {
    super('Vstupenku nelze darovat sám sobě.');
  }
}

/** 403 — Tento typ vstupenky nepovoluje převody */
export class TransferNotAllowedError extends ResaleError {
  readonly statusCode = 403;
  readonly code = 'TRANSFER_NOT_ALLOWED';

  constructor() {
    super('Tento typ vstupenky nepovoluje darování / převod.');
  }
}

/** 409 — Vstupenka už má aktivní dar v posledních 5 minutách */
export class TicketAlreadyTransferredError extends ResaleError {
  readonly statusCode = 409;
  readonly code = 'TICKET_ALREADY_TRANSFERRED';

  constructor() {
    super('Vstupenka byla nedávno převedena. Zkuste to za chvíli znovu.');
  }
}

// ---------------------------------------------------------------------------
// HTTP error mapping helper — used by all API route handlers
// ---------------------------------------------------------------------------

export function toHttpError(err: unknown): { status: number; body: { error: string; code: string } } {
  if (err instanceof ResaleError) {
    return {
      status: err.statusCode,
      body: { error: err.message, code: err.code },
    };
  }
  // Unknown / unexpected error — don't leak internals
  console.error('[resale] Unhandled error:', err);
  return {
    status: 500,
    body: { error: 'Internal server error', code: 'INTERNAL_ERROR' },
  };
}
