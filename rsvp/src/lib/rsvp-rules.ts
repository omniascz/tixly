// Pure domain rules for the RSVP module.
// No side effects — all functions are synchronous and deterministic.

import type { RsvpTicketType, RsvpEntry, RsvpStatus } from '../types/rsvp.types';
import {
  RsvpCapacityFullError,
  RsvpDeadlinePassedError,
  RsvpAlreadyExistsError,
  RsvpPlusOneNotAllowedError,
} from '../types/rsvp.types';

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

/**
 * Validates an incoming RSVP request against business rules.
 * Throws a typed error on any violation.
 * Capacity-full throws RsvpCapacityFullError (suggest_waitlist: true) —
 * the caller decides whether to proceed to waitlist.
 */
export function validateRsvpRequest(
  ticketType: RsvpTicketType,
  existingUserRsvps: RsvpEntry[],
  _userId: string,
  now: Date,
  options: { plusOne?: boolean } = {},
): void {
  // 1. Deadline check
  if (ticketType.deadline !== null && now > ticketType.deadline) {
    throw new RsvpDeadlinePassedError(
      `RSVP deadline was ${ticketType.deadline.toISOString()}. Registrations are closed.`,
    );
  }

  // 2. Duplicate check — any non-cancelled, non-rejected RSVP counts
  const active = existingUserRsvps.filter(
    (r) => r.status !== 'cancelled' && r.status !== 'rejected',
  );
  if (active.length >= ticketType.max_per_user) {
    throw new RsvpAlreadyExistsError(
      `You already have ${active.length} active RSVP(s) for this event (max: ${ticketType.max_per_user}).`,
    );
  }

  // 3. Plus-one check
  if (options.plusOne && !ticketType.allow_plus_one) {
    throw new RsvpPlusOneNotAllowedError(
      'This event does not allow plus-one companions.',
    );
  }

  // 4. Capacity check — throw last so deadline/duplicate are checked first
  if (ticketType.current_count >= ticketType.max_capacity) {
    throw new RsvpCapacityFullError();
  }
}

// ---------------------------------------------------------------------------
// Status resolution
// ---------------------------------------------------------------------------

/**
 * Returns true when the ticket type is configured for auto-approval
 * (i.e. approval_required === false).
 */
export function shouldAutoApprove(ticketType: RsvpTicketType): boolean {
  return !ticketType.approval_required;
}

/**
 * Resolves the initial RSVP status for a new registration.
 *
 * Decision tree:
 *   capacityFull                       → 'waitlisted'
 *   !capacityFull && auto-approve      → 'approved'
 *   !capacityFull && manual approval   → 'pending'
 */
export function getInitialStatus(
  ticketType: RsvpTicketType,
  capacityFull: boolean,
): RsvpStatus {
  if (capacityFull) {
    return 'waitlisted';
  }
  if (shouldAutoApprove(ticketType)) {
    return 'approved';
  }
  return 'pending';
}

// ---------------------------------------------------------------------------
// Waitlist
// ---------------------------------------------------------------------------

/**
 * Returns true when there is still room to promote someone from the waitlist.
 */
export function canPromoteFromWaitlist(ticketType: RsvpTicketType): boolean {
  return ticketType.current_count < ticketType.max_capacity;
}

// ---------------------------------------------------------------------------
// Confirmation messages
// ---------------------------------------------------------------------------

const MESSAGES = {
  cs: {
    approved: (name: string, event: string) =>
      `Vaše RSVP na akci „${event}" (${name}) bylo schváleno. Vstupenka byla vydána a čeká ve vaší peněžence.`,
    pending: (name: string, event: string) =>
      `Vaše RSVP na akci „${event}" (${name}) bylo přijato a čeká na schválení organizátorem.`,
    waitlisted: (name: string, event: string) =>
      `Kapacita akce „${event}" (${name}) je plná. Byli jste zařazeni na čekací listinu. Upozorníme vás, pokud se místo uvolní.`,
    rejected: (name: string, event: string) =>
      `Vaše RSVP na akci „${event}" (${name}) bylo zamítnuto.`,
    cancelled: (name: string, event: string) =>
      `Vaše RSVP na akci „${event}" (${name}) bylo zrušeno.`,
  },
  en: {
    approved: (name: string, event: string) =>
      `Your RSVP for "${event}" (${name}) has been approved. Your ticket has been issued and is waiting in your wallet.`,
    pending: (name: string, event: string) =>
      `Your RSVP for "${event}" (${name}) has been received and is awaiting organizer approval.`,
    waitlisted: (name: string, event: string) =>
      `"${event}" (${name}) is at full capacity. You have been added to the waitlist. We'll notify you if a spot opens up.`,
    rejected: (name: string, event: string) =>
      `Your RSVP for "${event}" (${name}) has been rejected.`,
    cancelled: (name: string, event: string) =>
      `Your RSVP for "${event}" (${name}) has been cancelled.`,
  },
} as const;

export interface RsvpConfirmationEvent {
  name: string;
  /** Optional ticket type name shown in parentheses; falls back to ticket_type_id when omitted */
  ticketTypeName?: string;
}

/**
 * Returns a human-readable confirmation message for the given RSVP entry.
 * Supports Czech ('cs') and English ('en').
 */
export function formatRsvpConfirmationMessage(
  entry: RsvpEntry,
  event: RsvpConfirmationEvent,
  lang: 'cs' | 'en',
): string {
  const t = MESSAGES[lang];
  const ticketTypeName = event.ticketTypeName ?? entry.ticket_type_id;
  const eventName = event.name;

  switch (entry.status) {
    case 'approved':
      return t.approved(ticketTypeName, eventName);
    case 'pending':
      return t.pending(ticketTypeName, eventName);
    case 'waitlisted':
      return t.waitlisted(ticketTypeName, eventName);
    case 'rejected':
      return t.rejected(ticketTypeName, eventName);
    case 'cancelled':
      return t.cancelled(ticketTypeName, eventName);
    default: {
      // exhaustive check
      const _exhaustive: never = entry.status;
      return _exhaustive;
    }
  }
}
