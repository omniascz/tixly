import type { FlashSale, FlashSalePublicView } from '../types/flash-sale.types';
import {
  FlashSaleNotFoundError,
  FlashSaleNotActiveError,
  FlashSaleCapacityExhaustedError,
  FlashSaleOverlapError,
  FlashSaleUnauthorizedError,
} from '../types/flash-sale.types';
import {
  calculateFlashPrice,
  validateFlashSaleTimes,
  toPublicView,
} from '../lib/flash-sale-calculator';

// ---------------------------------------------------------------------------
// FlashSaleDbAdapter — injected interface; never import a real DB client here
// ---------------------------------------------------------------------------

export interface FlashSaleDbAdapter {
  /** Returns null when not found */
  findFlashSale(id: string): Promise<FlashSale | null>;

  /** Returns an active or scheduled flash sale for the given ticket type, or null */
  findActiveFlashSaleForTicketType(ticketTypeId: string): Promise<FlashSale | null>;

  /** Returns the current base price for a ticket type in haléře */
  findTicketTypePrice(ticketTypeId: string): Promise<number>;

  /** Returns true when the organizer owns (or administers) the given ticket type */
  checkOrganizationOwnership(
    ticketTypeId: string,
    organizerId: string,
  ): Promise<boolean>;

  /** Persists a new flash sale; id and created_at are assigned by the DB */
  createFlashSale(
    data: Omit<FlashSale, 'id' | 'flash_sold_count' | 'created_at'>,
  ): Promise<FlashSale>;

  /** Updates just the status column */
  updateFlashSaleStatus(
    id: string,
    status: FlashSale['status'],
  ): Promise<void>;

  /**
   * Atomically increments flash_sold_count inside an existing transaction.
   * tx is the transaction handle produced by withTransaction.
   */
  incrementFlashSoldCount(id: string, tx: unknown): Promise<void>;

  /** Flash sales with status='scheduled' whose starts_at <= now */
  findScheduledToActivate(now: Date): Promise<FlashSale[]>;

  /** Flash sales with status='active' whose ends_at <= now */
  findActiveToEnd(now: Date): Promise<FlashSale[]>;

  /** Active flash sales for a given event (across all its ticket types) */
  findActiveByEvent(eventId: string): Promise<FlashSale[]>;

  /** Runs fn inside a serializable transaction; auto-commits or rolls back */
  withTransaction<T>(fn: (tx: unknown) => Promise<T>): Promise<T>;
}

// ---------------------------------------------------------------------------
// FlashSaleService
// ---------------------------------------------------------------------------

export class FlashSaleService {
  // -------------------------------------------------------------------------
  // createFlashSale
  // -------------------------------------------------------------------------

  async createFlashSale(
    ticketTypeId: string,
    organizerId: string,
    data: {
      eventId: string;
      name: string;
      discountType: FlashSale['discount_type'];
      discountValue: number;
      flashCapacity: number;
      startsAt: Date;
      endsAt: Date;
    },
    db: FlashSaleDbAdapter,
  ): Promise<FlashSale> {
    // 1. Ownership check
    const isOwner = await db.checkOrganizationOwnership(
      ticketTypeId,
      organizerId,
    );
    if (!isOwner) {
      throw new FlashSaleUnauthorizedError(
        'Organizer does not own the specified ticket type.',
      );
    }

    // 2. Fetch original price
    const originalPrice = await db.findTicketTypePrice(ticketTypeId);

    // 3. Compute flash price
    const flashPrice = calculateFlashPrice(
      originalPrice,
      data.discountType,
      data.discountValue,
    );

    // 4. Validate time window
    const now = new Date();
    validateFlashSaleTimes(data.startsAt, data.endsAt, now);

    // 5. Check for overlap — another active/scheduled sale for this ticket type
    const existing = await db.findActiveFlashSaleForTicketType(ticketTypeId);
    if (existing !== null) {
      throw new FlashSaleOverlapError(
        `A flash sale (id: ${existing.id}) for ticket type ${ticketTypeId} is already active or scheduled.`,
      );
    }

    // 6. Persist
    const sale = await db.createFlashSale({
      event_id: data.eventId,
      ticket_type_id: ticketTypeId,
      name: data.name,
      discount_type: data.discountType,
      discount_value: data.discountValue,
      flash_capacity: data.flashCapacity,
      original_price: originalPrice,
      flash_price: flashPrice,
      starts_at: data.startsAt,
      ends_at: data.endsAt,
      status: 'scheduled',
      created_by_organizer_id: organizerId,
    });

    return sale;
  }

  // -------------------------------------------------------------------------
  // activateFlashSale — manual activation before starts_at
  // -------------------------------------------------------------------------

  async activateFlashSale(
    id: string,
    organizerId: string,
    db: FlashSaleDbAdapter,
  ): Promise<FlashSale> {
    const sale = await db.findFlashSale(id);
    if (sale === null) {
      throw new FlashSaleNotFoundError(`Flash sale ${id} not found.`);
    }

    if (sale.created_by_organizer_id !== organizerId) {
      throw new FlashSaleUnauthorizedError(
        'Only the organizer who created this flash sale can activate it.',
      );
    }

    if (sale.status !== 'scheduled') {
      throw new FlashSaleNotActiveError(
        `Flash sale ${id} is in status '${sale.status}'. Only scheduled sales can be manually activated.`,
      );
    }

    await db.updateFlashSaleStatus(id, 'active');

    return { ...sale, status: 'active' };
  }

  // -------------------------------------------------------------------------
  // cancelFlashSale
  // -------------------------------------------------------------------------

  async cancelFlashSale(
    id: string,
    organizerId: string,
    db: FlashSaleDbAdapter,
  ): Promise<void> {
    const sale = await db.findFlashSale(id);
    if (sale === null) {
      throw new FlashSaleNotFoundError(`Flash sale ${id} not found.`);
    }

    if (sale.created_by_organizer_id !== organizerId) {
      throw new FlashSaleUnauthorizedError(
        'Only the organizer who created this flash sale can cancel it.',
      );
    }

    if (sale.status !== 'scheduled' && sale.status !== 'active') {
      throw new FlashSaleNotActiveError(
        `Flash sale ${id} is in status '${sale.status}'. Only scheduled or active sales can be cancelled.`,
      );
    }

    await db.updateFlashSaleStatus(id, 'cancelled');
  }

  // -------------------------------------------------------------------------
  // recordFlashSalePurchase — called by order service on successful checkout
  // -------------------------------------------------------------------------

  async recordFlashSalePurchase(
    flashSaleId: string,
    db: FlashSaleDbAdapter,
  ): Promise<void> {
    await db.withTransaction(async (tx) => {
      const sale = await db.findFlashSale(flashSaleId);

      if (sale === null) {
        throw new FlashSaleNotFoundError(
          `Flash sale ${flashSaleId} not found.`,
        );
      }

      if (sale.status !== 'active') {
        throw new FlashSaleNotActiveError(
          `Flash sale ${flashSaleId} is not active (status: '${sale.status}').`,
        );
      }

      if (sale.flash_sold_count >= sale.flash_capacity) {
        throw new FlashSaleCapacityExhaustedError(
          `Flash sale ${flashSaleId} has no remaining flash-price tickets.`,
        );
      }

      // Atomically increment — uses SELECT FOR UPDATE semantics via withTransaction
      await db.incrementFlashSoldCount(flashSaleId, tx);
    });
  }

  // -------------------------------------------------------------------------
  // getEventFlashSales — public view for buyers
  // -------------------------------------------------------------------------

  async getEventFlashSales(
    eventId: string,
    db: FlashSaleDbAdapter,
  ): Promise<FlashSalePublicView[]> {
    const sales = await db.findActiveByEvent(eventId);
    const now = new Date();
    return sales.map((sale) => toPublicView(sale, now));
  }

  // -------------------------------------------------------------------------
  // processScheduledActivations — run by cron every minute
  // -------------------------------------------------------------------------

  /**
   * Finds all flash sales with status='scheduled' whose starts_at <= now
   * and transitions them to 'active'.
   *
   * @returns Number of sales activated in this tick.
   */
  async processScheduledActivations(db: FlashSaleDbAdapter): Promise<number> {
    const now = new Date();
    const toActivate = await db.findScheduledToActivate(now);

    let count = 0;
    for (const sale of toActivate) {
      try {
        await db.updateFlashSaleStatus(sale.id, 'active');
        count++;
      } catch (err) {
        console.error(
          `[flash-sale] Failed to activate flash sale ${sale.id}:`,
          err,
        );
      }
    }

    return count;
  }

  // -------------------------------------------------------------------------
  // processExpiredFlashSales — run by cron every minute
  // -------------------------------------------------------------------------

  /**
   * Finds all flash sales with status='active' whose ends_at <= now
   * and transitions them to 'ended'.
   *
   * @returns Number of sales ended in this tick.
   */
  async processExpiredFlashSales(db: FlashSaleDbAdapter): Promise<number> {
    const now = new Date();
    const toEnd = await db.findActiveToEnd(now);

    let count = 0;
    for (const sale of toEnd) {
      try {
        await db.updateFlashSaleStatus(sale.id, 'ended');
        count++;
      } catch (err) {
        console.error(
          `[flash-sale] Failed to end flash sale ${sale.id}:`,
          err,
        );
      }
    }

    return count;
  }
}
