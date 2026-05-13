// ---------------------------------------------------------------------------
// Holdback types for Tixly inventory holdback system
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Enums
// ---------------------------------------------------------------------------

export enum HoldbackReleaseType {
  Manual = 'manual',
  Scheduled = 'scheduled',
  Trigger = 'trigger',
}

export enum HoldbackStatus {
  Active = 'active',
  Released = 'released',
  Cancelled = 'cancelled',
}

export enum HoldbackCategory {
  Sponsor = 'sponsor',
  Press = 'press',
  LastMinute = 'last_minute',
  VIP = 'vip',
}

// ---------------------------------------------------------------------------
// Core entity
// ---------------------------------------------------------------------------

export interface InventoryHoldback {
  id: string;
  ticketTypeId: string;
  eventId: string;
  organizerId: string;
  name: string;
  quantity: number;
  quantityReleased: number;
  category: HoldbackCategory;
  releaseType: HoldbackReleaseType;
  /** ISO timestamp — for scheduled releases */
  releaseAt: Date | null;
  /** 0–100.0 — for trigger-based releases (e.g. 80.0 = release at 80% sold) */
  releaseTriggerPct: number | null;
  /** Optional access code that buyers enter to unlock these tickets */
  accessCode: string | null;
  status: HoldbackStatus;
  notes: string | null;
  createdAt: Date;
  releasedAt: Date | null;
  /** UUID of the user who released (null for automatic releases) */
  releasedBy: string | null;
}

// ---------------------------------------------------------------------------
// Input types
// ---------------------------------------------------------------------------

export interface CreateHoldbackOptions {
  ticketTypeId: string;
  eventId: string;
  organizerId: string;
  name: string;
  quantity: number;
  category: HoldbackCategory;
  releaseType: HoldbackReleaseType;
  releaseAt?: Date;
  releaseTriggerPct?: number;
  accessCode?: string;
  notes?: string;
}

export interface ReleaseHoldbackOptions {
  /** Omit for full release */
  quantity?: number;
  /** If true, the released qty goes back into public remaining_qty */
  releaseToPublic: boolean;
  /** UUID of the user performing the release (null for automated jobs) */
  releasedBy?: string;
}

// ---------------------------------------------------------------------------
// Aggregated view per event
// ---------------------------------------------------------------------------

export interface HoldbackSummary {
  eventId: string;
  totalHoldbackQty: number;
  totalReleasedQty: number;
  activeCount: number;
  releasedCount: number;
  cancelledCount: number;
  holdbacks: InventoryHoldback[];
}

// ---------------------------------------------------------------------------
// Typed errors
// ---------------------------------------------------------------------------

export abstract class HoldbackError extends Error {
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

/** 422 — Requested holdback quantity exceeds available inventory */
export class InsufficientInventoryError extends HoldbackError {
  readonly statusCode = 422;
  readonly code = 'INSUFFICIENT_INVENTORY';

  constructor(requested: number, available: number) {
    super(
      `Requested holdback quantity ${requested} exceeds available inventory ${available}.`,
    );
  }
}

/** 404 — No holdback found for the given ID */
export class HoldbackNotFoundError extends HoldbackError {
  readonly statusCode = 404;
  readonly code = 'HOLDBACK_NOT_FOUND';

  constructor(id: string) {
    super(`Holdback not found: ${id}`);
  }
}

/** 403 — Authenticated user does not own this holdback / event */
export class UnauthorizedHoldbackError extends HoldbackError {
  readonly statusCode = 403;
  readonly code = 'UNAUTHORIZED';

  constructor() {
    super('You do not have permission to manage this holdback.');
  }
}

/** 409 — Holdback is not in 'active' status (already released or cancelled) */
export class AlreadyReleasedError extends HoldbackError {
  readonly statusCode = 409;
  readonly code = 'ALREADY_RELEASED';

  constructor(status: HoldbackStatus) {
    super(`Holdback is already in status '${status}' and cannot be modified.`);
  }
}

/** 422 — Partial release quantity exceeds unreleased quantity */
export class InvalidReleaseQuantityError extends HoldbackError {
  readonly statusCode = 422;
  readonly code = 'INVALID_RELEASE_QUANTITY';

  constructor(requested: number, available: number) {
    super(
      `Cannot release ${requested} tickets — only ${available} are still held back.`,
    );
  }
}

/** 422 — scheduled release_type missing release_at, or trigger missing pct */
export class InvalidHoldbackConfigError extends HoldbackError {
  readonly statusCode = 422;
  readonly code = 'INVALID_HOLDBACK_CONFIG';
}

// ---------------------------------------------------------------------------
// HTTP error mapping helper
// ---------------------------------------------------------------------------

export function toHoldbackHttpError(err: unknown): {
  status: number;
  body: { error: string; code: string };
} {
  if (err instanceof HoldbackError) {
    return {
      status: err.statusCode,
      body: { error: err.message, code: err.code },
    };
  }
  console.error('[holdback] Unhandled error:', err);
  return {
    status: 500,
    body: { error: 'Internal server error', code: 'INTERNAL_ERROR' },
  };
}
