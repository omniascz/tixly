// RSVP service — orchestrates RSVP lifecycle with atomic DB operations.

import type { RsvpEntry, RsvpStatus, RsvpTicketType } from '../types/rsvp.types';
import {
  RsvpCapacityFullError,
  RsvpDeadlinePassedError,
  RsvpAlreadyExistsError,
  RsvpPlusOneNotAllowedError,
  RsvpNotFoundError,
  RsvpNotPendingError,
  RsvpNotApprovedError,
  RsvpUnauthorizedError,
  RsvpTicketTypeNotFoundError,
} from '../types/rsvp.types';
import {
  validateRsvpRequest,
  getInitialStatus,
  canPromoteFromWaitlist,
} from '../lib/rsvp-rules';

// ---------------------------------------------------------------------------
// DB adapter interface
// ---------------------------------------------------------------------------

export interface RsvpDbAdapter {
  findRsvpById(id: string): Promise<RsvpEntry | null>;
  findRsvpTicketType(ticketTypeId: string): Promise<RsvpTicketType | null>;
  findUserRsvpsForEvent(userId: string, eventId: string): Promise<RsvpEntry[]>;
  createRsvp(
    data: {
      event_id: string;
      ticket_type_id: string;
      user_id: string;
      email: string;
      status: RsvpStatus;
      plus_one: boolean;
      notes: string | null;
    },
    tx: RsvpDbAdapter,
  ): Promise<RsvpEntry>;
  updateRsvpStatus(
    id: string,
    status: RsvpStatus,
    data: Partial<RsvpEntry>,
    tx: RsvpDbAdapter,
  ): Promise<RsvpEntry>;
  incrementRsvpCount(ticketTypeId: string, tx: RsvpDbAdapter): Promise<void>;
  decrementRsvpCount(ticketTypeId: string, tx: RsvpDbAdapter): Promise<void>;
  incrementWaitlistCount(ticketTypeId: string, tx: RsvpDbAdapter): Promise<void>;
  decrementWaitlistCount(ticketTypeId: string, tx: RsvpDbAdapter): Promise<void>;
  /** Returns earliest-created waitlisted entry for the ticket type (FIFO). */
  getNextWaitlisted(ticketTypeId: string): Promise<RsvpEntry | null>;
  /** Issues a ticket for an approved RSVP; returns the new ticket_id. */
  issueTicketForRsvp(rsvpId: string, tx: RsvpDbAdapter): Promise<string>;
  listRsvpsByTicketType(ticketTypeId: string, status?: RsvpStatus): Promise<RsvpEntry[]>;
  listRsvpsByUser(userId: string): Promise<RsvpEntry[]>;
  /** List every RSVP attached to an event — used for guest-list export. */
  listRsvpsByEvent?(eventId: string): Promise<RsvpEntry[]>;
  /** Finds RSVPs for events starting within the given time window with reminder_sent_at IS NULL */
  findRsvpsByEventTimeWindow(windowStart: Date, windowEnd: Date): Promise<RsvpEntry[]>;
  /** Finds event by ID; returns minimal event info with name. */
  findEventForRsvp(eventId: string): Promise<{ id: string; name: string } | null>;
  /** Updates the reminder_sent_at timestamp for an RSVP. */
  updateRsvpReminder(rsvpId: string, sentAt: Date): Promise<void>;
  withTransaction<T>(fn: (tx: RsvpDbAdapter) => Promise<T>): Promise<T>;
}

// ---------------------------------------------------------------------------
// Organizer ownership adapter
// ---------------------------------------------------------------------------

export interface RsvpOrganizerAdapter {
  isOrganizerOfEvent(organizerId: string, eventId: string): Promise<boolean>;
}

// ---------------------------------------------------------------------------
// RsvpService
// ---------------------------------------------------------------------------

export class RsvpService {
  constructor(private readonly organizer: RsvpOrganizerAdapter) {}

  // -------------------------------------------------------------------------
  // createRsvp
  // -------------------------------------------------------------------------

  /**
   * Registers a user for a free-admission event.
   *
   * 1. Load & validate ticket type (must be active)
   * 2. Load user's existing RSVPs for dedup
   * 3. validateRsvpRequest — throws on deadline / duplicate / plus_one;
   *    RsvpCapacityFullError is caught and re-routed to waitlist
   * 4. Determine initial status
   * 5. Atomically INSERT + increment counter
   * 6. If approved → issueTicket in same transaction
   */
  async createRsvp(
    ticketTypeId: string,
    userId: string,
    options: { plusOne?: boolean; notes?: string | null; email: string },
    db: RsvpDbAdapter,
  ): Promise<RsvpEntry> {
    // 1. Load ticket type
    const ticketType = await db.findRsvpTicketType(ticketTypeId);
    if (!ticketType || !ticketType.active) {
      throw new RsvpTicketTypeNotFoundError(
        `RSVP ticket type '${ticketTypeId}' not found or is not active.`,
      );
    }

    // 2. Load existing user RSVPs
    const existingRsvps = await db.findUserRsvpsForEvent(userId, ticketType.event_id);

    // 3. Validate rules; intercept capacity-full to allow waitlist
    let capacityFull = false;
    try {
      validateRsvpRequest(ticketType, existingRsvps, userId, new Date(), {
        plusOne: options.plusOne,
      });
    } catch (err) {
      if (err instanceof RsvpCapacityFullError) {
        // Re-validate non-capacity rules so errors surface cleanly
        const now = new Date();
        if (ticketType.deadline !== null && now > ticketType.deadline) {
          throw new RsvpDeadlinePassedError(
            `RSVP deadline was ${ticketType.deadline.toISOString()}. Registrations are closed.`,
          );
        }
        const active = existingRsvps.filter(
          (r) => r.status !== 'cancelled' && r.status !== 'rejected',
        );
        if (active.length >= ticketType.max_per_user) {
          throw new RsvpAlreadyExistsError(
            `You already have ${active.length} active RSVP(s) for this event (max: ${ticketType.max_per_user}).`,
          );
        }
        if (options.plusOne && !ticketType.allow_plus_one) {
          throw new RsvpPlusOneNotAllowedError('This event does not allow plus-one companions.');
        }
        capacityFull = true;
      } else {
        throw err;
      }
    }

    // 4. Resolve initial status
    const status = getInitialStatus(ticketType, capacityFull);

    // 5 & 6. Atomic insert + counter + optional ticket
    return db.withTransaction(async (tx) => {
      const created = await tx.createRsvp(
        {
          event_id: ticketType.event_id,
          ticket_type_id: ticketTypeId,
          user_id: userId,
          email: options.email,
          status,
          plus_one: options.plusOne ?? false,
          notes: options.notes ?? null,
        },
        tx,
      );

      if (status === 'waitlisted') {
        await tx.incrementWaitlistCount(ticketTypeId, tx);
        return created;
      }

      if (status === 'approved') {
        // Increment current_count only when slot is actually taken (approved)
        await tx.incrementRsvpCount(ticketTypeId, tx);
        const ticketId = await tx.issueTicketForRsvp(created.id, tx);
        return tx.updateRsvpStatus(
          created.id,
          'approved',
          { ticket_id: ticketId, approved_at: new Date() },
          tx,
        );
      }

      // status === 'pending': no slot reserved yet — organizer decides later
      return created;
    });
  }

  // -------------------------------------------------------------------------
  // approveRsvp
  // -------------------------------------------------------------------------

  /** Organizer manually approves a pending RSVP and issues its ticket. */
  async approveRsvp(
    rsvpId: string,
    organizerId: string,
    db: RsvpDbAdapter,
  ): Promise<RsvpEntry> {
    const entry = await this._requireRsvp(rsvpId, db);

    await this._requireOrganizer(organizerId, entry.event_id);

    if (entry.status !== 'pending') {
      throw new RsvpNotPendingError(entry.status);
    }

    return db.withTransaction(async (tx) => {
      const ticketId = await tx.issueTicketForRsvp(rsvpId, tx);
      await tx.incrementRsvpCount(entry.ticket_type_id, tx);
      return tx.updateRsvpStatus(
        rsvpId,
        'approved',
        { ticket_id: ticketId, approved_at: new Date() },
        tx,
      );
    });
  }

  // -------------------------------------------------------------------------
  // rejectRsvp
  // -------------------------------------------------------------------------

  /**
   * Organizer rejects a pending RSVP.
   * Pending RSVPs do not hold a slot in current_count, so no counter adjustment needed.
   */
  async rejectRsvp(
    rsvpId: string,
    organizerId: string,
    notes: string | null,
    db: RsvpDbAdapter,
  ): Promise<RsvpEntry> {
    const entry = await this._requireRsvp(rsvpId, db);

    await this._requireOrganizer(organizerId, entry.event_id);

    if (entry.status !== 'pending') {
      throw new RsvpNotPendingError(entry.status);
    }

    return db.withTransaction(async (tx) => {
      return tx.updateRsvpStatus(
        rsvpId,
        'rejected',
        { organizer_notes: notes, rejected_at: new Date() },
        tx,
      );
    });
  }

  // -------------------------------------------------------------------------
  // cancelRsvp
  // -------------------------------------------------------------------------

  /**
   * User cancels their own RSVP.
   * - approved / ticket_issued → free current_count slot → promote from waitlist
   * - pending → no slot held, just mark cancelled
   * - waitlisted → decrement waitlist_count
   */
  async cancelRsvp(
    rsvpId: string,
    userId: string,
    db: RsvpDbAdapter,
  ): Promise<RsvpEntry> {
    const entry = await this._requireRsvp(rsvpId, db);

    if (entry.user_id !== userId) {
      throw new RsvpUnauthorizedError('You can only cancel your own RSVP.');
    }

    if (entry.status === 'cancelled' || entry.status === 'rejected') {
      throw new RsvpNotPendingError(entry.status);
    }

    const cancelled = await db.withTransaction(async (tx) => {
      const updated = await tx.updateRsvpStatus(rsvpId, 'cancelled', {}, tx);

      if (entry.status === 'waitlisted') {
        await tx.decrementWaitlistCount(entry.ticket_type_id, tx);
      } else if (entry.status === 'approved') {
        // Only approved RSVPs hold a current_count slot; pending does not
        await tx.decrementRsvpCount(entry.ticket_type_id, tx);
      }
      // pending: no slot was held, no counter adjustment needed

      return updated;
    });

    // Promote next waitlisted entry when an approved slot was freed
    if (entry.status === 'approved') {
      await this.promoteFromWaitlist(entry.ticket_type_id, db);
    }

    return cancelled;
  }

  // -------------------------------------------------------------------------
  // promoteFromWaitlist
  // -------------------------------------------------------------------------

  /**
   * Promotes the earliest waitlisted RSVP (FIFO) to approved and issues a ticket.
   * Returns null when the waitlist is empty or capacity is still full.
   */
  async promoteFromWaitlist(
    ticketTypeId: string,
    db: RsvpDbAdapter,
  ): Promise<RsvpEntry | null> {
    const ticketType = await db.findRsvpTicketType(ticketTypeId);
    if (!ticketType) return null;
    if (!canPromoteFromWaitlist(ticketType)) return null;

    const next = await db.getNextWaitlisted(ticketTypeId);
    if (!next) return null;

    return db.withTransaction(async (tx) => {
      await tx.decrementWaitlistCount(ticketTypeId, tx);
      await tx.incrementRsvpCount(ticketTypeId, tx);
      const ticketId = await tx.issueTicketForRsvp(next.id, tx);
      return tx.updateRsvpStatus(
        next.id,
        'approved',
        { ticket_id: ticketId, approved_at: new Date() },
        tx,
      );
    });
  }

  // -------------------------------------------------------------------------
  // markNoShow — organizer flags approved attendee as not showing up
  // -------------------------------------------------------------------------
  //
  // Transitions an `approved` RSVP to `no_show`. Does NOT free the counter
  // slot — the attendee consumed a reserved place, so the slot stays accounted
  // for in current_count. Organizers use this for post-event reporting / to
  // down-rank chronic no-shows in future invite-only events.

  async markNoShow(
    rsvpId: string,
    organizerId: string,
    db: RsvpDbAdapter,
  ): Promise<RsvpEntry> {
    const entry = await this._requireRsvp(rsvpId, db);
    await this._requireOrganizer(organizerId, entry.event_id);

    if (entry.status !== 'approved') {
      throw new RsvpNotApprovedError(entry.status);
    }

    return db.withTransaction(async (tx) =>
      tx.updateRsvpStatus(
        rsvpId,
        'no_show',
        { no_show_at: new Date() },
        tx,
      ),
    );
  }

  // -------------------------------------------------------------------------
  // listRsvpsForEvent — guest-list export (organizer-only)
  // -------------------------------------------------------------------------
  //
  // Returns every RSVP attached to an event (across all ticket types). Used
  // for the guest-list export endpoint. Requires organizer ownership.

  async listRsvpsForEvent(
    eventId: string,
    organizerId: string,
    db: RsvpDbAdapter,
  ): Promise<RsvpEntry[]> {
    await this._requireOrganizer(organizerId, eventId);
    if (!db.listRsvpsByEvent) {
      throw new Error('RsvpDbAdapter.listRsvpsByEvent not implemented');
    }
    return db.listRsvpsByEvent(eventId);
  }

  // -------------------------------------------------------------------------
  // Private helpers
  // -------------------------------------------------------------------------

  private async _requireRsvp(rsvpId: string, db: RsvpDbAdapter): Promise<RsvpEntry> {
    const entry = await db.findRsvpById(rsvpId);
    if (!entry) {
      throw new RsvpNotFoundError(`RSVP '${rsvpId}' not found.`);
    }
    return entry;
  }

  private async _requireOrganizer(organizerId: string, eventId: string): Promise<void> {
    const isOwner = await this.organizer.isOrganizerOfEvent(organizerId, eventId);
    if (!isOwner) {
      throw new RsvpUnauthorizedError('You are not the organizer of this event.');
    }
  }
}
