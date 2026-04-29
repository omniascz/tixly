// ---------------------------------------------------------------------------
// Guest List — core domain types
// ---------------------------------------------------------------------------

export type GuestStatus = 'invited' | 'confirmed' | 'checked_in' | 'no_show' | 'cancelled';

export type GuestType = 'complimentary' | 'press' | 'vip' | 'industry' | 'promo' | 'other';

export interface GuestEntry {
  id: string;
  event_id: string;
  name: string;
  email: string | null;
  phone: string | null;
  guest_type: GuestType;
  status: GuestStatus;
  /** How many additional people the guest brings (0 = only this guest). */
  plus_count: number;
  /** plus_count + 1 — total headcount for this entry. */
  total_count: number;
  /** IDs of zones this guest can access. */
  zone_access: string[];
  /** Internal note — never sent to the guest. */
  notes: string | null;
  added_by_user_id: string;
  confirmed_at: Date | null;
  checked_in_at: Date | null;
  checked_in_by_staff_id: string | null;
  created_at: Date;
  updated_at: Date;
}

export interface GuestListSummary {
  total: number;
  invited: number;
  confirmed: number;
  checked_in: number;
  no_show: number;
  cancelled: number;
  /** Sum of total_count for all non-cancelled guests. */
  total_headcount: number;
}

export interface GuestSearchResult {
  guests: GuestEntry[];
  total: number;
}

// ---------------------------------------------------------------------------
// Typed errors
// ---------------------------------------------------------------------------

abstract class GuestListError extends Error {
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

export class GuestNotFoundError extends GuestListError {
  readonly statusCode = 404;
  readonly code = 'GUEST_NOT_FOUND';
  constructor(id: string) {
    super(`Guest not found: ${id}`);
  }
}

export class GuestAlreadyCheckedInError extends GuestListError {
  readonly statusCode = 409;
  readonly code = 'GUEST_ALREADY_CHECKED_IN';
  constructor(id: string) {
    super(`Guest ${id} is already checked in.`);
  }
}

export class GuestCancelledError extends GuestListError {
  readonly statusCode = 409;
  readonly code = 'GUEST_CANCELLED';
  constructor(id: string) {
    super(`Guest ${id} has been cancelled and cannot be processed.`);
  }
}

export class GuestListUnauthorizedError extends GuestListError {
  readonly statusCode = 403;
  readonly code = 'GUEST_LIST_UNAUTHORIZED';
  constructor(message = 'You are not authorized to manage this guest list.') {
    super(message);
  }
}

export class GuestDuplicateError extends GuestListError {
  readonly statusCode = 409;
  readonly code = 'GUEST_DUPLICATE';
  constructor(email: string, eventId: string) {
    super(`A guest with email ${email} already exists on the guest list for event ${eventId}.`);
  }
}

// ---------------------------------------------------------------------------
// HTTP error helper — used by all route handlers
// ---------------------------------------------------------------------------

export function toHttpError(err: unknown): { status: number; body: { error: string; code: string } } {
  if (err instanceof GuestListError) {
    return { status: err.statusCode, body: { error: err.message, code: err.code } };
  }
  console.error('[guest-list] Unhandled error:', err);
  return { status: 500, body: { error: 'Internal server error', code: 'INTERNAL_ERROR' } };
}
