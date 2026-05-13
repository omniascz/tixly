// ---------------------------------------------------------------------------
// Guest List Service
// ---------------------------------------------------------------------------

import type {
  GuestEntry,
  GuestStatus,
  GuestType,
  GuestListSummary,
  GuestSearchResult,
} from '../types/guest-list.types.js';
import {
  GuestNotFoundError,
  GuestAlreadyCheckedInError,
  GuestCancelledError,
  GuestListUnauthorizedError,
  GuestDuplicateError,
} from '../types/guest-list.types.js';
import {
  validateGuestEntry,
  canCheckIn,
  normalizeGuestName,
  normalizeEmail,
  searchGuests,
} from '../lib/guest-list-validator.js';

// ---------------------------------------------------------------------------
// Port interfaces (hex-arch adapters)
// ---------------------------------------------------------------------------

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyTx = any;

export interface GuestListDbAdapter {
  findGuest(id: string): Promise<GuestEntry | null>;
  findGuestByEmail(eventId: string, email: string): Promise<GuestEntry | null>;
  createGuest(data: Omit<GuestEntry, 'id' | 'created_at' | 'updated_at'>): Promise<GuestEntry>;
  updateGuest(id: string, data: Partial<GuestEntry>): Promise<GuestEntry>;
  listGuestsByEvent(
    eventId: string,
    filters?: { status?: GuestStatus; type?: GuestType },
  ): Promise<GuestEntry[]>;
  searchGuestsByEvent(eventId: string, query: string): Promise<GuestEntry[]>;
  getEventSummary(eventId: string): Promise<GuestListSummary>;
  checkOrganizerOwnership(eventId: string, userId: string): Promise<boolean>;
  withTransaction<T>(fn: (tx: AnyTx) => Promise<T>): Promise<T>;
}

export interface KafkaProducerAdapter {
  publish(topic: string, payload: unknown): Promise<void>;
}

// ---------------------------------------------------------------------------
// Input types
// ---------------------------------------------------------------------------

export interface AddGuestInput {
  name: string;
  email?: string;
  phone?: string;
  guestType: GuestType;
  plusCount: number;
  zoneAccess?: string[];
  notes?: string;
}

// ---------------------------------------------------------------------------
// GuestListService
// ---------------------------------------------------------------------------

export const GuestListService = {
  // -------------------------------------------------------------------------
  // addGuest
  // -------------------------------------------------------------------------
  async addGuest(
    eventId: string,
    addedByUserId: string,
    data: AddGuestInput,
    db: GuestListDbAdapter,
    kafka: KafkaProducerAdapter,
  ): Promise<GuestEntry> {
    const normalizedName = normalizeGuestName(data.name);
    const normalizedEmail = data.email ? normalizeEmail(data.email) : undefined;

    validateGuestEntry({
      name: normalizedName,
      email: normalizedEmail,
      plusCount: data.plusCount,
    });

    if (normalizedEmail) {
      const existing = await db.findGuestByEmail(eventId, normalizedEmail);
      if (existing) {
        throw new GuestDuplicateError(normalizedEmail, eventId);
      }
    }

    const guest = await db.createGuest({
      event_id: eventId,
      name: normalizedName,
      email: normalizedEmail ?? null,
      phone: data.phone ?? null,
      guest_type: data.guestType,
      status: 'invited',
      plus_count: data.plusCount,
      total_count: data.plusCount + 1,
      zone_access: data.zoneAccess ?? [],
      notes: data.notes ?? null,
      added_by_user_id: addedByUserId,
      confirmed_at: null,
      checked_in_at: null,
      checked_in_by_staff_id: null,
    });

    await kafka.publish('guest.invited', {
      guestId: guest.id,
      eventId,
      email: guest.email,
      name: guest.name,
    });

    return guest;
  },

  // -------------------------------------------------------------------------
  // bulkAddGuests
  // -------------------------------------------------------------------------
  async bulkAddGuests(
    eventId: string,
    addedByUserId: string,
    guests: AddGuestInput[],
    db: GuestListDbAdapter,
    kafka: KafkaProducerAdapter,
  ): Promise<{ added: GuestEntry[]; failed: Array<{ data: unknown; error: string }> }> {
    const results = await Promise.allSettled(
      guests.map((g) => GuestListService.addGuest(eventId, addedByUserId, g, db, kafka)),
    );

    const added: GuestEntry[] = [];
    const failed: Array<{ data: unknown; error: string }> = [];

    results.forEach((result, index) => {
      if (result.status === 'fulfilled') {
        added.push(result.value);
      } else {
        failed.push({
          data: guests[index],
          error: result.reason instanceof Error ? result.reason.message : String(result.reason),
        });
      }
    });

    return { added, failed };
  },

  // -------------------------------------------------------------------------
  // confirmAttendance
  // -------------------------------------------------------------------------
  async confirmAttendance(guestId: string, db: GuestListDbAdapter): Promise<GuestEntry> {
    const guest = await db.findGuest(guestId);
    if (!guest) throw new GuestNotFoundError(guestId);

    if (guest.status === 'cancelled') throw new GuestCancelledError(guestId);

    // Idempotent: already confirmed → return as-is
    if (guest.status === 'confirmed') return guest;

    return db.updateGuest(guestId, {
      status: 'confirmed',
      confirmed_at: new Date(),
    });
  },

  // -------------------------------------------------------------------------
  // checkInGuest
  // -------------------------------------------------------------------------
  async checkInGuest(
    guestId: string,
    staffId: string,
    db: GuestListDbAdapter,
  ): Promise<GuestEntry> {
    const guest = await db.findGuest(guestId);
    if (!guest) throw new GuestNotFoundError(guestId);

    const { allowed, reason } = canCheckIn(guest, new Date());
    if (!allowed) {
      if (guest.status === 'checked_in') throw new GuestAlreadyCheckedInError(guestId);
      if (guest.status === 'cancelled') throw new GuestCancelledError(guestId);
      throw new Error(reason ?? 'Check-in not allowed.');
    }

    return db.withTransaction(async () =>
      db.updateGuest(guestId, {
        status: 'checked_in',
        checked_in_at: new Date(),
        checked_in_by_staff_id: staffId,
      }),
    );
  },

  // -------------------------------------------------------------------------
  // markNoShow
  // -------------------------------------------------------------------------
  async markNoShow(
    guestId: string,
    _staffId: string,
    db: GuestListDbAdapter,
  ): Promise<GuestEntry> {
    const guest = await db.findGuest(guestId);
    if (!guest) throw new GuestNotFoundError(guestId);

    if (guest.status !== 'invited' && guest.status !== 'confirmed') {
      throw new Error(
        `Cannot mark guest as no-show: current status is "${guest.status}".`,
      );
    }

    return db.updateGuest(guestId, { status: 'no_show' });
  },

  // -------------------------------------------------------------------------
  // removeGuest (soft delete → cancelled)
  // -------------------------------------------------------------------------
  async removeGuest(
    guestId: string,
    userId: string,
    db: GuestListDbAdapter,
  ): Promise<void> {
    const guest = await db.findGuest(guestId);
    if (!guest) throw new GuestNotFoundError(guestId);

    const isOrganizer = await db.checkOrganizerOwnership(guest.event_id, userId);
    const isAdder = guest.added_by_user_id === userId;

    if (!isOrganizer && !isAdder) {
      throw new GuestListUnauthorizedError(
        'Only the organizer or the user who added the guest can remove them.',
      );
    }

    await db.updateGuest(guestId, { status: 'cancelled' });
  },

  // -------------------------------------------------------------------------
  // searchGuests
  // -------------------------------------------------------------------------
  async searchGuests(
    eventId: string,
    query: string,
    db: GuestListDbAdapter,
  ): Promise<GuestSearchResult> {
    const allGuests = await db.listGuestsByEvent(eventId);
    const filtered = searchGuests(allGuests, query);
    return { guests: filtered, total: filtered.length };
  },

  // -------------------------------------------------------------------------
  // getEventSummary
  // -------------------------------------------------------------------------
  async getEventSummary(
    eventId: string,
    db: GuestListDbAdapter,
  ): Promise<GuestListSummary> {
    return db.getEventSummary(eventId);
  },
};
