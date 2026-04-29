import type {
  InventoryHoldback,
  CreateHoldbackOptions,
  ReleaseHoldbackOptions,
  HoldbackSummary,
} from '../types/holdback.types';
import {
  HoldbackReleaseType,
  HoldbackStatus,
  HoldbackNotFoundError,
  UnauthorizedHoldbackError,
  AlreadyReleasedError,
  InvalidHoldbackConfigError,
} from '../types/holdback.types';
import {
  calculateAvailableForHoldback,
  calculateReleasedQty,
  calculateSellThroughPct,
  shouldAutoRelease,
  validateHoldbackQuantity,
} from '../lib/holdback-calculator';

// ---------------------------------------------------------------------------
// DB adapter interface — injected, never imported from ORM/driver directly
// ---------------------------------------------------------------------------

export interface TicketTypeRow {
  id: string;
  eventId: string;
  organizerId: string;
  totalQty: number;
  soldQty: number;
  remainingQty: number;
}

export interface HoldbackDbAdapter {
  /** Return ticket type + basic event ownership info */
  getTicketType(ticketTypeId: string): Promise<TicketTypeRow | null>;

  /** Sum of quantities for all ACTIVE holdbacks on a ticket type */
  getActiveHoldbackTotal(ticketTypeId: string): Promise<number>;

  /** Insert a new holdback row — called inside an open transaction */
  insertHoldback(
    holdback: Omit<InventoryHoldback, 'id' | 'createdAt'>,
  ): Promise<InventoryHoldback>;

  /** Decrement remaining_qty by delta — called inside an open transaction */
  decrementRemainingQty(ticketTypeId: string, delta: number): Promise<void>;

  /** Increment remaining_qty by delta — called inside an open transaction */
  incrementRemainingQty(ticketTypeId: string, delta: number): Promise<void>;

  /** Fetch holdback by ID */
  getHoldback(holdbackId: string): Promise<InventoryHoldback | null>;

  /** Fetch all holdbacks for an event */
  getHoldbacksByEvent(eventId: string): Promise<InventoryHoldback[]>;

  /** Fetch all ACTIVE holdbacks for a ticket type (used for access code validation) */
  getActiveHoldbacksByTicketType(ticketTypeId: string): Promise<InventoryHoldback[]>;

  /** Update mutable holdback fields */
  updateHoldback(
    holdbackId: string,
    patch: Partial<
      Pick<
        InventoryHoldback,
        | 'quantityReleased'
        | 'status'
        | 'releasedAt'
        | 'releasedBy'
      >
    >,
  ): Promise<InventoryHoldback>;

  /**
   * Execute a callback inside a serializable transaction.
   * The adapter is responsible for BEGIN/COMMIT/ROLLBACK.
   */
  withTransaction<T>(fn: () => Promise<T>): Promise<T>;

  /**
   * Find all ACTIVE, SCHEDULED holdbacks whose release_at <= now.
   * Used by the cron job.
   */
  findScheduledHoldbacksDue(now: Date): Promise<InventoryHoldback[]>;

  /**
   * Find all ACTIVE, TRIGGER holdbacks.
   * Used by the cron job to check sell-through thresholds.
   */
  findTriggerHoldbacks(): Promise<InventoryHoldback[]>;
}

// ---------------------------------------------------------------------------
// HoldbackService
// ---------------------------------------------------------------------------

export class HoldbackService {
  constructor(private readonly db: HoldbackDbAdapter) {}

  // -------------------------------------------------------------------------
  // createHoldback
  // -------------------------------------------------------------------------

  async createHoldback(
    options: CreateHoldbackOptions,
  ): Promise<InventoryHoldback> {
    // 1. Validate release type configuration
    this.validateReleaseConfig(options);

    // 2. Verify organizer owns the event via the ticket type
    const ticketType = await this.db.getTicketType(options.ticketTypeId);
    if (ticketType === null) {
      throw new HoldbackNotFoundError(options.ticketTypeId);
    }
    if (ticketType.organizerId !== options.organizerId) {
      throw new UnauthorizedHoldbackError();
    }

    // 3. Calculate available inventory
    const existingHoldbackTotal = await this.db.getActiveHoldbackTotal(
      options.ticketTypeId,
    );
    const available = calculateAvailableForHoldback(
      ticketType.totalQty,
      ticketType.soldQty,
      existingHoldbackTotal,
    );

    // 4. Validate requested quantity
    validateHoldbackQuantity(options.quantity, available);

    // 5. Atomic transaction: INSERT holdback + UPDATE remaining_qty
    const holdback = await this.db.withTransaction(async () => {
      const created = await this.db.insertHoldback({
        ticketTypeId: options.ticketTypeId,
        eventId: options.eventId,
        organizerId: options.organizerId,
        name: options.name,
        quantity: options.quantity,
        category: options.category,
        quantityReleased: 0,
        releaseType: options.releaseType,
        releaseAt: options.releaseAt ?? null,
        releaseTriggerPct: options.releaseTriggerPct ?? null,
        accessCode: options.accessCode ?? null,
        status: HoldbackStatus.Active,
        notes: options.notes ?? null,
        releasedAt: null,
        releasedBy: null,
      });

      await this.db.decrementRemainingQty(options.ticketTypeId, options.quantity);

      return created;
    });

    return holdback;
  }

  // -------------------------------------------------------------------------
  // releaseHoldback
  // -------------------------------------------------------------------------

  async releaseHoldback(
    holdbackId: string,
    organizerId: string,
    options: ReleaseHoldbackOptions,
  ): Promise<InventoryHoldback> {
    const holdback = await this.db.getHoldback(holdbackId);
    if (holdback === null) {
      throw new HoldbackNotFoundError(holdbackId);
    }
    if (holdback.organizerId !== organizerId) {
      throw new UnauthorizedHoldbackError();
    }
    if (holdback.status !== HoldbackStatus.Active) {
      throw new AlreadyReleasedError(holdback.status);
    }

    // Determine how many to release (partial or full)
    const releaseQty = calculateReleasedQty(
      holdback,
      options.quantity ?? 0,
    );

    const newQuantityReleased = holdback.quantityReleased + releaseQty;
    const isFullyReleased = newQuantityReleased >= holdback.quantity;
    const newStatus = isFullyReleased
      ? HoldbackStatus.Released
      : HoldbackStatus.Active;

    const now = new Date();

    const updated = await this.db.withTransaction(async () => {
      const result = await this.db.updateHoldback(holdbackId, {
        quantityReleased: newQuantityReleased,
        status: newStatus,
        releasedAt: isFullyReleased ? now : null,
        releasedBy: options.releasedBy ?? null,
      });

      if (options.releaseToPublic) {
        await this.db.incrementRemainingQty(holdback.ticketTypeId, releaseQty);
      }

      return result;
    });

    return updated;
  }

  // -------------------------------------------------------------------------
  // cancelHoldback
  // -------------------------------------------------------------------------

  async cancelHoldback(
    holdbackId: string,
    organizerId: string,
  ): Promise<void> {
    const holdback = await this.db.getHoldback(holdbackId);
    if (holdback === null) {
      throw new HoldbackNotFoundError(holdbackId);
    }
    if (holdback.organizerId !== organizerId) {
      throw new UnauthorizedHoldbackError();
    }
    if (holdback.status !== HoldbackStatus.Active) {
      throw new AlreadyReleasedError(holdback.status);
    }

    // Quantity still held (not yet released) goes back to public
    const stillHeld = holdback.quantity - holdback.quantityReleased;

    await this.db.withTransaction(async () => {
      await this.db.updateHoldback(holdbackId, {
        status: HoldbackStatus.Cancelled,
      });

      // Always restore unreleased qty to public pool on cancel
      if (stillHeld > 0) {
        await this.db.incrementRemainingQty(holdback.ticketTypeId, stillHeld);
      }
    });
  }

  // -------------------------------------------------------------------------
  // getEventHoldbacks
  // -------------------------------------------------------------------------

  async getEventHoldbacks(
    eventId: string,
    organizerId: string,
  ): Promise<HoldbackSummary> {
    const holdbacks = await this.db.getHoldbacksByEvent(eventId);

    // Verify organizer owns at least one holdback on this event,
    // or return empty summary (they own the event but have no holdbacks yet).
    // Ownership is checked at creation time — we trust the data here.
    const owned = holdbacks.filter((h) => h.organizerId === organizerId);

    // If there are holdbacks but none belong to this organizer — unauthorized
    if (holdbacks.length > 0 && owned.length === 0) {
      throw new UnauthorizedHoldbackError();
    }

    const active = owned.filter((h) => h.status === HoldbackStatus.Active);
    const released = owned.filter((h) => h.status === HoldbackStatus.Released);
    const cancelled = owned.filter((h) => h.status === HoldbackStatus.Cancelled);

    const totalHoldbackQty = owned.reduce((sum, h) => sum + h.quantity, 0);
    const totalReleasedQty = owned.reduce(
      (sum, h) => sum + h.quantityReleased,
      0,
    );

    return {
      eventId,
      totalHoldbackQty,
      totalReleasedQty,
      activeCount: active.length,
      releasedCount: released.length,
      cancelledCount: cancelled.length,
      holdbacks: owned,
    };
  }

  // -------------------------------------------------------------------------
  // validateAccessCode
  // -------------------------------------------------------------------------

  async validateAccessCode(
    ticketTypeId: string,
    code: string,
  ): Promise<{ valid: boolean; unlocksTickets: number }> {
    // Fetch all ACTIVE holdbacks for this specific ticket type.
    const holdbacks = await this.db.getActiveHoldbacksByTicketType(ticketTypeId);

    // Filter by matching access code (case-sensitive exact match).
    // The comparison intentionally does not short-circuit on the first match
    // so that timing is consistent regardless of how many holdbacks exist.
    const matchingHoldbacks = holdbacks.filter(
      (h) =>
        h.accessCode !== null &&
        h.accessCode === code,
    );

    if (matchingHoldbacks.length === 0) {
      return { valid: false, unlocksTickets: 0 };
    }

    const unlocksTickets = matchingHoldbacks.reduce(
      (sum, h) => sum + (h.quantity - h.quantityReleased),
      0,
    );

    return { valid: true, unlocksTickets };
  }

  // -------------------------------------------------------------------------
  // processScheduledReleases — called by cron job
  // -------------------------------------------------------------------------

  async processScheduledReleases(): Promise<{
    released: number;
    errors: number;
  }> {
    const now = new Date();
    let released = 0;
    let errors = 0;

    // --- Scheduled releases ---
    const scheduledDue = await this.db.findScheduledHoldbacksDue(now);

    for (const holdback of scheduledDue) {
      try {
        await this.releaseHoldback(
          holdback.id,
          holdback.organizerId,
          { releaseToPublic: true, releasedBy: undefined },
        );
        released++;
      } catch (err) {
        console.error(
          `[holdback-release] Failed to release scheduled holdback ${holdback.id}:`,
          err,
        );
        errors++;
      }
    }

    // --- Trigger-based releases ---
    const triggerHoldbacks = await this.db.findTriggerHoldbacks();

    for (const holdback of triggerHoldbacks) {
      try {
        const ticketType = await this.db.getTicketType(holdback.ticketTypeId);
        if (ticketType === null) continue;

        const sellThroughPct = calculateSellThroughPct(
          ticketType.totalQty,
          ticketType.soldQty,
        );

        if (shouldAutoRelease(holdback, sellThroughPct, now)) {
          await this.releaseHoldback(
            holdback.id,
            holdback.organizerId,
            { releaseToPublic: true, releasedBy: undefined },
          );
          released++;
        }
      } catch (err) {
        console.error(
          `[holdback-release] Failed to process trigger holdback ${holdback.id}:`,
          err,
        );
        errors++;
      }
    }

    return { released, errors };
  }

  // -------------------------------------------------------------------------
  // Private helpers
  // -------------------------------------------------------------------------

  private validateReleaseConfig(options: CreateHoldbackOptions): void {
    if (
      options.releaseType === HoldbackReleaseType.Scheduled &&
      options.releaseAt === undefined
    ) {
      throw new InvalidHoldbackConfigError(
        "release_type 'scheduled' requires release_at to be set.",
      );
    }

    if (
      options.releaseType === HoldbackReleaseType.Trigger &&
      options.releaseTriggerPct === undefined
    ) {
      throw new InvalidHoldbackConfigError(
        "release_type 'trigger' requires release_trigger_pct to be set.",
      );
    }

    if (
      options.releaseType === HoldbackReleaseType.Trigger &&
      options.releaseTriggerPct !== undefined &&
      (options.releaseTriggerPct <= 0 || options.releaseTriggerPct > 100)
    ) {
      throw new InvalidHoldbackConfigError(
        'release_trigger_pct must be between 0.1 and 100.0.',
      );
    }
  }
}
