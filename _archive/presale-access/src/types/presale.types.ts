// ---------------------------------------------------------------------------
// Presale types for Tixly presale access system
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Core entity
// ---------------------------------------------------------------------------

export interface PresaleConfig {
  ticket_type_id: string;
  /** HMAC-SHA256 hash of the presale code — never store plain text */
  presale_code_hash: string;
  presale_start: Date;
  presale_end: Date;
  /** null = shares main inventory; positive integer = dedicated presale allocation */
  presale_capacity: number | null;
  presale_sold_count: number;
}

// ---------------------------------------------------------------------------
// Status union
// ---------------------------------------------------------------------------

export type PresaleAccessStatus =
  | 'presale_not_started'
  | 'presale_active'
  | 'presale_ended'
  | 'presale_sold_out'
  | 'public_sale_active'
  | 'not_on_sale';

// ---------------------------------------------------------------------------
// Validation result
// ---------------------------------------------------------------------------

export interface PresaleValidationResult {
  status: PresaleAccessStatus;
  /** true only when presale is active AND code is valid (or public sale active) */
  access_granted: boolean;
  presale_active: boolean;
  public_sale_active: boolean;
  /** Human-readable Czech message */
  message: string;
}

// ---------------------------------------------------------------------------
// Typed errors
// ---------------------------------------------------------------------------

export abstract class PresaleError extends Error {
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

/** Provided code does not match stored hash */
export class PresaleInvalidCodeError extends PresaleError {
  readonly statusCode = 403;
  readonly code = 'PRESALE_INVALID_CODE';

  constructor() {
    super('Neplatný presale kód.');
  }
}

/** Presale window has already ended */
export class PresaleExpiredError extends PresaleError {
  readonly statusCode = 410;
  readonly code = 'PRESALE_EXPIRED';

  constructor() {
    super('Presale přístup vypršel.');
  }
}

/** Presale window has not started yet */
export class PresaleNotStartedError extends PresaleError {
  readonly statusCode = 403;
  readonly code = 'PRESALE_NOT_STARTED';

  constructor(presaleStart: Date) {
    super(
      `Presale ještě nezačalo. Začíná ${presaleStart.toISOString()}.`,
    );
  }
}

/** Presale allocation is fully sold out */
export class PresaleSoldOutError extends PresaleError {
  readonly statusCode = 409;
  readonly code = 'PRESALE_SOLD_OUT';

  constructor() {
    super('Presale vstupenky jsou vyprodány.');
  }
}

/** Organizer does not own the event/ticket type */
export class UnauthorizedPresaleError extends PresaleError {
  readonly statusCode = 403;
  readonly code = 'UNAUTHORIZED';

  constructor() {
    super('Nemáte oprávnění spravovat presale pro tuto vstupenku.');
  }
}

/** Ticket type has no presale configuration */
export class PresaleNotConfiguredError extends PresaleError {
  readonly statusCode = 404;
  readonly code = 'PRESALE_NOT_CONFIGURED';

  constructor(ticketTypeId: string) {
    super(`Typ vstupenky '${ticketTypeId}' nemá nastaven presale přístup.`);
  }
}

// ---------------------------------------------------------------------------
// Geofencing types
// ---------------------------------------------------------------------------

export type CountryCode = 'CZ' | 'SK' | 'PL' | 'AT' | 'DE' | string;

export interface GeofenceConfig {
  /** ISO 3166-1 alpha-2 codes allowed */
  allowedCountries: CountryCode[];
  /** Optional override: if user has a verified Czech/Slovak phone they bypass IP check */
  bypassForVerifiedLocalUsers: boolean;
}

export const DEFAULT_LOCAL_EVENT_GEOFENCE: GeofenceConfig = {
  allowedCountries: ['CZ', 'SK'],
  bypassForVerifiedLocalUsers: true,
};

/** Geofence check failed — country not allowed */
export class GeofenceBlockedError extends PresaleError {
  readonly statusCode = 403;
  readonly code = 'GEOFENCE_BLOCKED';

  constructor(country: string | null, allowed: string[]) {
    super(
      `Presale není dostupný z vaší země (${country ?? 'unknown'}). Povolené země: ${allowed.join(', ')}.`,
    );
  }
}

// ---------------------------------------------------------------------------
// HTTP error mapping helper
// ---------------------------------------------------------------------------

export function toPresaleHttpError(err: unknown): {
  status: number;
  body: { error: string; code: string };
} {
  if (err instanceof PresaleError) {
    return {
      status: err.statusCode,
      body: { error: err.message, code: err.code },
    };
  }
  console.error('[presale] Unhandled error:', err);
  return {
    status: 500,
    body: { error: 'Interní chyba serveru', code: 'INTERNAL_ERROR' },
  };
}
