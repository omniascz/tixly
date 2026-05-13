// Delayed delivery — domain types
// A ticket is purchased and paid but delivered digitally only shortly before the event.

// ---------------------------------------------------------------------------
// Enums / union types
// ---------------------------------------------------------------------------

export type DeliveryScheduleType = 'timed' | 'manual' | 'immediate';

export type DeliveryStatus = 'pending' | 'delivered' | 'failed' | 'cancelled';

export type DeliveryChannel = 'email' | 'push' | 'wallet' | 'sms';

/**
 * Embargo status — separate concern from delivery status.
 * 'embargoed': ticket has been delivered but is blocked from scanning until release_at.
 * 'released':  embargo has lifted and ticket is scannable.
 */
export type TicketEmbargoStatus = 'embargoed' | 'released';

// ---------------------------------------------------------------------------
// Core domain objects
// ---------------------------------------------------------------------------

/**
 * One delivery schedule entry — created at purchase time, processed by the cron job.
 *
 * State machine:
 *   pending → delivered  (happy path)
 *   pending → failed     (Kafka publish error, retry_count < 3)
 *   failed  → delivered  (retry succeeded)
 *   failed  → failed     (retry_count = 3, terminal)
 *   pending → cancelled  (event cancelled / organiser revoke)
 */
export interface DeliverySchedule {
  id: string;
  ticket_id: string;
  order_id: string;
  event_id: string;
  /** UTC datetime of the event — used to compute deliver_at for timed deliveries */
  event_starts_at: Date;
  delivery_type: DeliveryScheduleType;
  /**
   * For timed: event_starts_at - hours_before hours.
   * For manual/immediate: null (delivery triggered explicitly or immediately).
   */
  deliver_at: Date | null;
  /** Number of hours before event start to deliver — only for timed type */
  hours_before: number | null;
  status: DeliveryStatus;
  /** Which notification channels to trigger */
  channels: DeliveryChannel[];
  delivered_at: Date | null;
  failed_at: Date | null;
  /** Incremented on each failed Kafka publish attempt; max 3 retries */
  retry_count: number;
  created_at: Date;
}

// ---------------------------------------------------------------------------
// Configuration per ticket type (set by organiser)
// ---------------------------------------------------------------------------

/**
 * DeliveryConfig is stored per ticket type and determines how tickets
 * of that type are scheduled at purchase time.
 */
export interface DeliveryConfig {
  ticket_type_id: string;
  delivery_type: DeliveryScheduleType;
  /** Required when delivery_type = 'timed'; must be > 0 */
  hours_before: number | null;
  channels: DeliveryChannel[];
  active: boolean;
}

// ---------------------------------------------------------------------------
// Kafka event payload
// ---------------------------------------------------------------------------

/** Published to topic 'ticket.delivery' when a ticket is delivered */
export interface TicketDeliveredEvent {
  eventType: 'ticket.delivered';
  ticketId: string;
  orderId: string;
  userId: string;
  channels: DeliveryChannel[];
  /** ISO 8601 UTC string */
  deliveredAt: string;
}

// ---------------------------------------------------------------------------
// Typed errors
// ---------------------------------------------------------------------------

abstract class DeliveryError extends Error {
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

/** 404 — No delivery schedule found for the given ticket ID */
export class DeliveryScheduleNotFoundError extends DeliveryError {
  readonly statusCode = 404;
  readonly code = 'DELIVERY_SCHEDULE_NOT_FOUND';
}

/** 409 — Ticket has already been delivered and cannot be delivered again */
export class DeliveryAlreadyDeliveredError extends DeliveryError {
  readonly statusCode = 409;
  readonly code = 'DELIVERY_ALREADY_DELIVERED';
}

/** 404 — No delivery config found for the given ticket type ID */
export class DeliveryConfigNotFoundError extends DeliveryError {
  readonly statusCode = 404;
  readonly code = 'DELIVERY_CONFIG_NOT_FOUND';
}

/** 422 — Delivery config is structurally invalid (e.g. timed without hours_before) */
export class DeliveryInvalidConfigError extends DeliveryError {
  readonly statusCode = 422;
  readonly code = 'DELIVERY_INVALID_CONFIG';
}

// ---------------------------------------------------------------------------
// Embargo configuration and release tracking
// ---------------------------------------------------------------------------

/**
 * TicketEmbargoConfig — per-event or global embargo policy.
 * Determines if purchased tickets are embargoed and for how long.
 */
export interface TicketEmbargoConfig {
  event_id: string;
  embargo_enabled: boolean;
  /** Days before event start when embargo lifts and tickets become scannable */
  embargo_days_before: number;
  created_at: Date;
  updated_at: Date;
}

/**
 * TicketEmbargo — per-ticket embargo state.
 * Created when ticket is purchased with embargo enabled.
 * Release_at is calculated as: event_starts_at - embargo_days_before days.
 */
export interface TicketEmbargo {
  ticket_id: string;
  event_id: string;
  delivery_status: TicketEmbargoStatus;
  /** When the embargo lifts — tickets become scannable after this time */
  release_at: Date;
  released_at: Date | null;
  created_at: Date;
}

// ---------------------------------------------------------------------------
// HTTP error mapping helper
// ---------------------------------------------------------------------------

export function toDeliveryHttpError(err: unknown): {
  status: number;
  body: { error: string; code: string };
} {
  if (err instanceof DeliveryError) {
    return { status: err.statusCode, body: { error: err.message, code: err.code } };
  }
  console.error('[delayed-delivery] Unhandled error:', err);
  return { status: 500, body: { error: 'Internal server error', code: 'INTERNAL_ERROR' } };
}

// Re-export scanning gate helper for convenience
// (defined in lib/delivery-calculator.ts but re-exported here for discoverability)
export { isTicketDelivered } from '../lib/delivery-calculator.js';
