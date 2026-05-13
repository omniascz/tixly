// Pure calculation functions for delayed delivery scheduling.
// No I/O, no side-effects — safe to use in tests and edge functions.

import type { DeliverySchedule, DeliveryConfig, TicketDeliveredEvent } from '../types/delayed-delivery.types';
import { DeliveryInvalidConfigError } from '../types/delayed-delivery.types';

// ---------------------------------------------------------------------------
// calculateDeliverAt
// ---------------------------------------------------------------------------

/**
 * Returns the exact UTC datetime at which the ticket should be delivered.
 *
 * @param eventStartsAt - UTC start time of the event
 * @param hoursBefore   - How many hours before the event the ticket is delivered
 * @returns             deliver_at date (eventStartsAt - hoursBefore * 3 600 000 ms)
 */
export function calculateDeliverAt(eventStartsAt: Date, hoursBefore: number): Date {
  return new Date(eventStartsAt.getTime() - hoursBefore * 3_600_000);
}

// ---------------------------------------------------------------------------
// isDeliveryDue
// ---------------------------------------------------------------------------

/**
 * Returns true when a timed delivery schedule is due to be processed right now.
 *
 * - timed:     deliver_at <= now AND status = 'pending'
 * - manual:    always false — triggered explicitly via API
 * - immediate: always false — cron picks these up as ordinary pending items
 *              (deliver_at = purchase time, so isDeliveryDue covers them naturally,
 *               but the service marks them delivered inline; this guards the cron path)
 */
export function isDeliveryDue(schedule: DeliverySchedule, now: Date): boolean {
  if (schedule.delivery_type !== 'timed') return false;
  if (schedule.status !== 'pending') return false;
  if (schedule.deliver_at === null) return false;
  return schedule.deliver_at.getTime() <= now.getTime();
}

// ---------------------------------------------------------------------------
// validateDeliveryConfig
// ---------------------------------------------------------------------------

/**
 * Validates a DeliveryConfig and throws DeliveryInvalidConfigError on failure.
 *
 * Rules:
 *   - timed requires hours_before to be a positive integer
 *   - manual and immediate require no additional fields
 */
export function validateDeliveryConfig(config: DeliveryConfig): void {
  if (config.delivery_type === 'timed') {
    if (config.hours_before === null || config.hours_before === undefined) {
      throw new DeliveryInvalidConfigError(
        'hours_before is required for timed delivery type',
      );
    }
    if (config.hours_before <= 0) {
      throw new DeliveryInvalidConfigError(
        `hours_before must be greater than 0, got ${config.hours_before}`,
      );
    }
  }
}

// ---------------------------------------------------------------------------
// shouldRetry
// ---------------------------------------------------------------------------

/**
 * Returns true when a failed schedule is eligible for another delivery attempt.
 * Maximum 3 total attempts (retry_count tracks how many have already failed).
 */
export function shouldRetry(schedule: DeliverySchedule): boolean {
  return schedule.status === 'failed' && schedule.retry_count < 3;
}

// ---------------------------------------------------------------------------
// buildKafkaPayload
// ---------------------------------------------------------------------------

/**
 * Constructs the Kafka event payload that downstream services consume to
 * send email, push, Wallet pass, and SMS notifications.
 */
export function buildKafkaPayload(
  schedule: DeliverySchedule,
  userId: string,
): TicketDeliveredEvent {
  return {
    eventType: 'ticket.delivered',
    ticketId: schedule.ticket_id,
    orderId: schedule.order_id,
    userId,
    channels: schedule.channels,
    deliveredAt: new Date().toISOString(),
  };
}

// ---------------------------------------------------------------------------
// isTicketDelivered — gate for scanner to check embargo status
// ---------------------------------------------------------------------------

/**
 * Determines if a ticket can be scanned (embargo has lifted).
 * Used by the gate scanner to authorize entry.
 *
 * Contract: scanner must call this before allowing entry.
 * Returns true only if ticket's delivery_status is 'released' OR no embargo is configured.
 *
 * @param deliveryStatus - Value from ticket.delivery_status field (from TicketEmbargo)
 * @returns true if ticket is scannable (embargo released or not embargoed)
 */
export function isTicketDelivered(deliveryStatus?: string): boolean {
  // No embargo status = not embargoed, treat as delivered/scannable
  if (!deliveryStatus) return true;
  // Only 'released' status allows scanning
  return deliveryStatus === 'released';
}
