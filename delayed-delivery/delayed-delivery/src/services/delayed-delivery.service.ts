// DelayedDeliveryService — orchestrates scheduling, delivering and retrying
// ticket deliveries. All I/O is injected via adapters for testability.

import type { DeliverySchedule, DeliveryConfig } from '../types/delayed-delivery.types';
import {
  DeliveryScheduleNotFoundError,
  DeliveryAlreadyDeliveredError,
} from '../types/delayed-delivery.types';
import {
  calculateDeliverAt,
  validateDeliveryConfig,
  buildKafkaPayload,
  shouldRetry,
} from '../lib/delivery-calculator';

// ---------------------------------------------------------------------------
// Adapter interfaces — injected at call site; concrete implementations live
// in the infrastructure layer (Postgres, KafkaJS, etc.)
// ---------------------------------------------------------------------------

export interface DeliveryDbAdapter {
  /** Find a schedule by ticket ID (returns null if none exists yet) */
  findSchedule(ticketId: string): Promise<DeliverySchedule | null>;

  /** Find a schedule by its own ID */
  findScheduleById(id: string): Promise<DeliverySchedule | null>;

  /** Find the delivery config associated with a ticket type */
  findDeliveryConfig(ticketTypeId: string): Promise<DeliveryConfig | null>;

  /** Persist a new schedule row */
  createSchedule(
    data: Omit<DeliverySchedule, 'id' | 'created_at'>,
  ): Promise<DeliverySchedule>;

  /** Partial update an existing schedule row */
  updateSchedule(id: string, data: Partial<DeliverySchedule>): Promise<DeliverySchedule>;

  /**
   * Return all timed pending schedules whose deliver_at <= now.
   * Immediate schedules with deliver_at = purchase time are also included here.
   */
  findDueSchedules(now: Date): Promise<DeliverySchedule[]>;

  /** Return all failed schedules that are still eligible for retry (retry_count < 3) */
  findFailedForRetry(now: Date): Promise<DeliverySchedule[]>;

  /** Look up the buyer/owner user ID for the given ticket */
  getUserIdForTicket(ticketId: string): Promise<string>;

  /**
   * Find all embargoed tickets whose release_at <= now.
   * Used by the embargo release cron job.
   */
  findExpiredEmbargoes(now: Date): Promise<Array<{ ticket_id: string; embargo_id: string }>>;

  /** Update embargo status to 'released' and set released_at timestamp */
  releaseEmbargo(ticketId: string, embargoId: string): Promise<void>;
}

export interface KafkaProducerAdapter {
  publish(topic: string, payload: unknown): Promise<void>;
}

// ---------------------------------------------------------------------------
// Service
// ---------------------------------------------------------------------------

/**
 * DelayedDeliveryService — orchestrates ticket delivery scheduling and embargo release.
 *
 * Scanning Gate Contract:
 *   The gate scanner MUST check the ticket's delivery_status before allowing entry.
 *   Use the isTicketDelivered() helper from delivery-calculator.ts:
 *
 *   ```
 *   import { isTicketDelivered } from '../lib/delivery-calculator';
 *   if (!isTicketDelivered(ticket.delivery_status)) {
 *     return { allowed: false, reason: 'ticket_embargoed' };
 *   }
 *   ```
 *
 *   delivery_status values:
 *   - 'released': embargo has lifted, ticket is scannable
 *   - 'embargoed': ticket is held until embargo expires (release_at time)
 *   - undefined/null: no embargo configured for this ticket, always scannable
 */
export class DelayedDeliveryService {
  // -------------------------------------------------------------------------
  // scheduleDelivery
  // -------------------------------------------------------------------------

  /**
   * Called at purchase time. Creates a DeliverySchedule based on the ticket
   * type's DeliveryConfig.
   *
   * Behaviour per delivery_type:
   *   - immediate: deliver_at = now so the next cron run picks it up immediately
   *   - timed:     deliver_at = event_starts_at - hours_before hours
   *   - manual:    deliver_at = null; organiser triggers via API
   *
   * If no DeliveryConfig exists for the ticket type, falls back to immediate.
   */
  async scheduleDelivery(
    ticketId: string,
    orderId: string,
    eventId: string,
    ticketTypeId: string,
    eventStartsAt: Date,
    db: DeliveryDbAdapter,
  ): Promise<DeliverySchedule> {
    const now = new Date();

    // Load config — fall back to immediate if none configured
    const config = await db.findDeliveryConfig(ticketTypeId);

    let deliverAt: Date | null = null;
    let hoursBefore: number | null = null;
    let deliveryType: DeliveryConfig['delivery_type'] = 'immediate';
    let channels: DeliveryConfig['channels'] = ['email'];

    if (config && config.active) {
      validateDeliveryConfig(config);
      deliveryType = config.delivery_type;
      hoursBefore = config.hours_before;
      channels = config.channels;

      if (config.delivery_type === 'timed' && config.hours_before !== null) {
        deliverAt = calculateDeliverAt(eventStartsAt, config.hours_before);
      } else if (config.delivery_type === 'immediate') {
        deliverAt = now;
      }
      // manual → deliver_at stays null
    } else {
      // No active config → immediate with default email channel
      deliverAt = now;
    }

    return db.createSchedule({
      ticket_id: ticketId,
      order_id: orderId,
      event_id: eventId,
      event_starts_at: eventStartsAt,
      delivery_type: deliveryType,
      deliver_at: deliverAt,
      hours_before: hoursBefore,
      status: 'pending',
      channels,
      delivered_at: null,
      failed_at: null,
      retry_count: 0,
    });
  }

  // -------------------------------------------------------------------------
  // deliverTicket
  // -------------------------------------------------------------------------

  /**
   * Executes the actual delivery for a single schedule entry:
   * 1. Validates the schedule exists and has not already been delivered.
   * 2. Publishes a TicketDeliveredEvent to Kafka topic 'ticket.delivery'.
   * 3. Marks the schedule as delivered.
   */
  async deliverTicket(
    scheduleId: string,
    db: DeliveryDbAdapter,
    kafka: KafkaProducerAdapter,
  ): Promise<void> {
    const schedule = await db.findScheduleById(scheduleId);
    if (!schedule) {
      throw new DeliveryScheduleNotFoundError(
        `Delivery schedule not found: ${scheduleId}`,
      );
    }

    if (schedule.status === 'delivered') {
      throw new DeliveryAlreadyDeliveredError(
        `Ticket ${schedule.ticket_id} has already been delivered`,
      );
    }

    const userId = await db.getUserIdForTicket(schedule.ticket_id);
    const payload = buildKafkaPayload(schedule, userId);

    await kafka.publish('ticket.delivery', payload);

    await db.updateSchedule(scheduleId, {
      status: 'delivered',
      delivered_at: new Date(),
    });
  }

  // -------------------------------------------------------------------------
  // triggerManualDelivery
  // -------------------------------------------------------------------------

  /**
   * Called by an organiser via the POST /trigger endpoint.
   * Only works for schedules with delivery_type = 'manual' that are still pending.
   */
  async triggerManualDelivery(
    ticketId: string,
    _organizerId: string,
    db: DeliveryDbAdapter,
    kafka: KafkaProducerAdapter,
  ): Promise<void> {
    const schedule = await db.findSchedule(ticketId);
    if (!schedule) {
      throw new DeliveryScheduleNotFoundError(
        `No delivery schedule found for ticket ${ticketId}`,
      );
    }

    if (schedule.status === 'delivered') {
      throw new DeliveryAlreadyDeliveredError(
        `Ticket ${ticketId} has already been delivered`,
      );
    }

    await this.deliverTicket(schedule.id, db, kafka);
  }

  // -------------------------------------------------------------------------
  // processDueDeliveries
  // -------------------------------------------------------------------------

  /**
   * Cron handler — finds all due timed/immediate schedules and delivers them.
   * On Kafka failure the schedule is marked failed and retry_count is incremented.
   * Once retry_count reaches 3 the schedule is considered terminally failed.
   */
  async processDueDeliveries(
    db: DeliveryDbAdapter,
    kafka: KafkaProducerAdapter,
  ): Promise<{ delivered: number; failed: number }> {
    const now = new Date();
    const dueSchedules = await db.findDueSchedules(now);

    let delivered = 0;
    let failed = 0;

    for (const schedule of dueSchedules) {
      try {
        await this.deliverTicket(schedule.id, db, kafka);
        delivered++;
        console.info(
          `[delayed-delivery] Delivered ticket ${schedule.ticket_id} (schedule ${schedule.id})`,
        );
      } catch (err) {
        // Don't count idempotent "already delivered" as failures
        if (err instanceof DeliveryAlreadyDeliveredError) {
          console.warn(
            `[delayed-delivery] Schedule ${schedule.id} already delivered — skipping`,
          );
          continue;
        }

        const newRetryCount = schedule.retry_count + 1;
        const terminal = newRetryCount >= 3;

        await db.updateSchedule(schedule.id, {
          status: 'failed',
          retry_count: newRetryCount,
          failed_at: new Date(),
        });

        if (terminal) {
          console.error(
            `[delayed-delivery] Schedule ${schedule.id} failed permanently after ${newRetryCount} attempts:`,
            err,
          );
        } else {
          console.warn(
            `[delayed-delivery] Schedule ${schedule.id} failed (attempt ${newRetryCount}/3):`,
            err,
          );
        }

        failed++;
      }
    }

    return { delivered, failed };
  }

  // -------------------------------------------------------------------------
  // retryFailed
  // -------------------------------------------------------------------------

  /**
   * Cron handler — retries all schedules that failed but still have retries left.
   * Returns the count of successfully retried deliveries.
   */
  async retryFailed(
    db: DeliveryDbAdapter,
    kafka: KafkaProducerAdapter,
  ): Promise<number> {
    const now = new Date();
    const failedSchedules = await db.findFailedForRetry(now);

    let retried = 0;

    for (const schedule of failedSchedules) {
      if (!shouldRetry(schedule)) continue;

      try {
        await this.deliverTicket(schedule.id, db, kafka);
        retried++;
        console.info(
          `[delayed-delivery] Retry succeeded for ticket ${schedule.ticket_id} (schedule ${schedule.id})`,
        );
      } catch (err) {
        const newRetryCount = schedule.retry_count + 1;
        const terminal = newRetryCount >= 3;

        await db.updateSchedule(schedule.id, {
          status: 'failed',
          retry_count: newRetryCount,
          failed_at: new Date(),
        });

        if (terminal) {
          console.error(
            `[delayed-delivery] Schedule ${schedule.id} permanently failed after ${newRetryCount} attempts:`,
            err,
          );
        } else {
          console.warn(
            `[delayed-delivery] Retry ${newRetryCount}/3 failed for schedule ${schedule.id}:`,
            err,
          );
        }
      }
    }

    return retried;
  }

  // -------------------------------------------------------------------------
  // releaseExpiredEmbargoes
  // -------------------------------------------------------------------------

  /**
   * Embargo release cron handler — finds all embargoed tickets whose embargo
   * has expired (release_at <= now) and marks them as 'released'.
   *
   * Emits Kafka 'ticket.embargo_released' event for each released ticket.
   * Returns the count of successfully released tickets.
   */
  async releaseExpiredEmbargoes(
    db: DeliveryDbAdapter,
    kafka: KafkaProducerAdapter,
  ): Promise<{ released: number }> {
    const now = new Date();
    const expiredEmbargoes = await db.findExpiredEmbargoes(now);

    let released = 0;

    for (const embargo of expiredEmbargoes) {
      try {
        await db.releaseEmbargo(embargo.ticket_id, embargo.embargo_id);
        released++;

        // Emit Kafka event for downstream services (e.g., scanner gate, notifications)
        await kafka.publish('ticket.embargo_released', {
          eventType: 'ticket.embargo_released',
          ticketId: embargo.ticket_id,
          releasedAt: new Date().toISOString(),
        });

        console.info(
          `[delayed-delivery] Released embargo for ticket ${embargo.ticket_id}`,
        );
      } catch (err) {
        console.error(
          `[delayed-delivery] Failed to release embargo for ticket ${embargo.ticket_id}:`,
          err,
        );
      }
    }

    return { released };
  }
}
