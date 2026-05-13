// RSVP module — domain types

export type RsvpStatus =
  | 'pending'
  | 'approved'
  | 'rejected'
  | 'cancelled'
  | 'waitlisted'
  | 'no_show';

export interface RsvpEntry {
  id: string;
  event_id: string;
  ticket_type_id: string; // must have price = 0
  user_id: string;
  email: string;                   // attendee's email
  status: RsvpStatus;
  plus_one: boolean;
  notes: string | null;            // attendee's note to organizer when registering
  organizer_notes: string | null;  // internal organizer note (visible only to organizer)
  ticket_id: string | null;        // set after ticket_issued
  created_at: Date;
  updated_at: Date;
  approved_at: Date | null;
  rejected_at: Date | null;
  reminder_sent_at: Date | null;   // when the RSVP reminder was sent
  no_show_at: Date | null;         // when the attendee was marked as no-show after the event
}

export interface RsvpTicketType {
  id: string;
  event_id: string;
  name: string;
  description: string | null;
  max_capacity: number;
  current_count: number;   // approved + ticket_issued
  waitlist_count: number;
  deadline: Date | null;   // null = until event start
  approval_required: boolean;
  allow_plus_one: boolean;
  max_per_user: number;
  active: boolean;
}

// ---------------------------------------------------------------------------
// Typed errors
// ---------------------------------------------------------------------------

abstract class RsvpError extends Error {
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

/** 409 — Capacity full; suggest_waitlist indicates whether waitlist is available */
export class RsvpCapacityFullError extends RsvpError {
  readonly statusCode = 409;
  readonly code = 'RSVP_CAPACITY_FULL';
  readonly suggest_waitlist = true;

  constructor(message = 'RSVP capacity is full. You can join the waitlist.') {
    super(message);
  }
}

/** 422 — RSVP deadline has passed */
export class RsvpDeadlinePassedError extends RsvpError {
  readonly statusCode = 422;
  readonly code = 'RSVP_DEADLINE_PASSED';
}

/** 409 — User already has an active RSVP for this event */
export class RsvpAlreadyExistsError extends RsvpError {
  readonly statusCode = 409;
  readonly code = 'RSVP_ALREADY_EXISTS';
}

/** 404 — RSVP not found */
export class RsvpNotFoundError extends RsvpError {
  readonly statusCode = 404;
  readonly code = 'RSVP_NOT_FOUND';
}

/** 409 — RSVP is not in 'pending' status; cannot approve or reject */
export class RsvpNotPendingError extends RsvpError {
  readonly statusCode = 409;
  readonly code = 'RSVP_NOT_PENDING';

  constructor(currentStatus: RsvpStatus) {
    super(`RSVP is in status '${currentStatus}'; only pending RSVPs can be approved or rejected.`);
  }
}

/** 409 — RSVP must be 'approved' to be marked as no-show */
export class RsvpNotApprovedError extends RsvpError {
  readonly statusCode = 409;
  readonly code = 'RSVP_NOT_APPROVED';

  constructor(currentStatus: RsvpStatus) {
    super(`RSVP is in status '${currentStatus}'; only approved RSVPs can be marked as no-show.`);
  }
}

/** 403 — Authenticated user is not the organizer of this event */
export class RsvpUnauthorizedError extends RsvpError {
  readonly statusCode = 403;
  readonly code = 'RSVP_UNAUTHORIZED';
}

/** 422 — plus_one requested but ticket type does not allow it */
export class RsvpPlusOneNotAllowedError extends RsvpError {
  readonly statusCode = 422;
  readonly code = 'RSVP_PLUS_ONE_NOT_ALLOWED';
}

/** 404 — RSVP ticket type not found or not active */
export class RsvpTicketTypeNotFoundError extends RsvpError {
  readonly statusCode = 404;
  readonly code = 'RSVP_TICKET_TYPE_NOT_FOUND';
}

// ---------------------------------------------------------------------------
// HTTP error mapping helper — used by API route handlers
// ---------------------------------------------------------------------------

export function toRsvpHttpError(err: unknown): { status: number; body: { error: string; code: string; suggest_waitlist?: boolean } } {
  if (err instanceof RsvpCapacityFullError) {
    return {
      status: err.statusCode,
      body: { error: err.message, code: err.code, suggest_waitlist: err.suggest_waitlist },
    };
  }
  if (err instanceof RsvpError) {
    return {
      status: err.statusCode,
      body: { error: err.message, code: err.code },
    };
  }
  console.error('[rsvp] Unhandled error:', err);
  return {
    status: 500,
    body: { error: 'Internal server error', code: 'INTERNAL_ERROR' },
  };
}
