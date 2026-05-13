// ─── Domain types re-used across the cloning module ──────────────────────────

export type EventStatus = 'draft' | 'published' | 'cancelled' | 'postponed'
export type TicketKind = 'standing' | 'seated' | 'season_pass' | 'bundle'

export interface Event {
  id: string
  organizer_id: string
  venue_id: string | null
  title: string
  description: string | null
  category: string | null
  subcategory: string | null
  date_start: Date
  date_end: Date
  status: EventStatus
  capacity: number | null
  image_url: string | null
  on_sale_at: Date | null
  off_sale_at: Date | null
  resale_allowed: boolean
  resale_commission_rate: number | null
  re_entry_allowed: boolean
  zone_access_rules: Record<string, unknown> | null
  tags: string[]
  metadata: Record<string, unknown> | null
  created_at: Date
  updated_at: Date
}

export interface TicketType {
  id: string
  event_id: string
  name: string
  kind: TicketKind
  base_price: number
  total_qty: number
  remaining_qty: number
  max_per_user: number | null
  sale_start_at: Date | null
  sale_end_at: Date | null
  zone_id: string | null
  is_active: boolean
  created_at: Date
  updated_at: Date
}

export interface PricingRule {
  id: string
  ticket_type_id: string
  phase: string | null
  threshold_qty: number | null
  threshold_date: Date | null
  price: number
  demand_factor: number | null
  min_price: number | null
  max_price: number | null
  created_at: Date
  updated_at: Date
}

// ─── Clone options ────────────────────────────────────────────────────────────

export type CloneEventOptions = {
  /** New event start date/time — required, must be in the future */
  newDateStart: Date
  /** New event end date/time — required, must be after newDateStart */
  newDateEnd: Date
  /** Defaults to: original title + " (kopie)" */
  newTitle?: string
  /** When tickets go on sale for the cloned event. NULL if not provided. */
  onSaleAt?: Date
  /** When tickets go off sale for the cloned event. NULL if not provided. */
  offSaleAt?: Date
  /**
   * If true all base_price values on ticket types are kept as-is but pricing
   * rules are NOT cloned (useful for a clean-price reset scenario).
   * Default: false — keep prices and clone pricing rules normally.
   */
  resetPricing?: boolean
  /** Clone ticket types. Default: true */
  cloneTicketTypes?: boolean
  /**
   * Clone pricing rules per ticket type. Only effective when cloneTicketTypes
   * is true. Default: true.
   */
  clonePricingRules?: boolean
}

// ─── Clone result ─────────────────────────────────────────────────────────────

export type CloneEventResult = {
  originalEventId: string
  newEventId: string
  clonedTicketTypes: number
  clonedPricingRules: number
  /** Non-fatal notices the organiser should review */
  warnings: string[]
}

// ─── Typed errors ─────────────────────────────────────────────────────────────

export class CloneValidationError extends Error {
  readonly kind = 'CloneValidationError' as const
  constructor(
    public readonly validationErrors: string[],
    message = `Clone validation failed: ${validationErrors.join('; ')}`,
  ) {
    super(message)
    this.name = 'CloneValidationError'
    Object.setPrototypeOf(this, CloneValidationError.prototype)
  }
}

export class EventNotFoundError extends Error {
  readonly kind = 'EventNotFoundError' as const
  constructor(public readonly eventId: string) {
    super(`Event not found: ${eventId}`)
    this.name = 'EventNotFoundError'
    Object.setPrototypeOf(this, EventNotFoundError.prototype)
  }
}

export class UnauthorizedCloneError extends Error {
  readonly kind = 'UnauthorizedCloneError' as const
  constructor(
    public readonly eventId: string,
    public readonly organizerId: string,
  ) {
    super(
      `Organizer '${organizerId}' is not authorized to clone event '${eventId}'`,
    )
    this.name = 'UnauthorizedCloneError'
    Object.setPrototypeOf(this, UnauthorizedCloneError.prototype)
  }
}

export type CloneError =
  | CloneValidationError
  | EventNotFoundError
  | UnauthorizedCloneError

// ─── DB adapter interface ─────────────────────────────────────────────────────

export type { DbAdapter } from '@tixly/db-adapter';
import type { DbAdapter } from '@tixly/db-adapter';

// ─── Recurring series types ───────────────────────────────────────────────────

/** RFC 5545 RRULE string, e.g. "FREQ=WEEKLY;BYDAY=MO;COUNT=10" */
export type RRuleString = string

export interface RecurringSeriesConfig {
  /** The parent/template event — its id becomes parent_event_id on children */
  parentEventId: string
  /** RFC 5545 RRULE (no DTSTART — we use parent event's start time) */
  rrule: RRuleString
  /** How far ahead to auto-publish (days). Occurrences beyond this stay as drafts. */
  publishWindowDays: number
  /** Optional hard cap on total children — overrides COUNT/UNTIL in RRULE */
  maxOccurrences?: number
  /** Status applied to auto-created children. Default 'draft' until publishWindow triggers. */
  initialStatus?: 'draft' | 'published'
}

export interface RecurringSeries {
  id: string
  parentEventId: string
  rrule: RRuleString
  publishWindowDays: number
  maxOccurrences: number | null
  initialStatus: 'draft' | 'published'
  lastGeneratedAt: Date | null
  lastGeneratedUntil: Date | null
  isActive: boolean
  createdAt: Date
  updatedAt: Date
}

export interface SeriesOccurrence {
  childEventId: string
  seriesId: string
  parentEventId: string
  occurrenceStart: Date
  occurrenceEnd: Date
  status: 'draft' | 'published' | 'cancelled'
  autoPublishedAt: Date | null
}

export interface GenerateOccurrencesResult {
  seriesId: string
  generated: number
  published: number
  skipped: number
  nextRunAt: Date
}

export class InvalidRRuleError extends Error {
  readonly kind = 'InvalidRRuleError' as const
  constructor(
    public readonly rrule: string,
    public readonly cause?: unknown,
  ) {
    super(`Invalid RRULE: ${rrule}`)
    this.name = 'InvalidRRuleError'
    Object.setPrototypeOf(this, InvalidRRuleError.prototype)
  }
}

export class SeriesNotFoundError extends Error {
  readonly kind = 'SeriesNotFoundError' as const
  constructor(public readonly seriesId: string) {
    super(`Recurring series not found or inactive: ${seriesId}`)
    this.name = 'SeriesNotFoundError'
    Object.setPrototypeOf(this, SeriesNotFoundError.prototype)
  }
}

export class ParentEventNotFoundError extends Error {
  readonly kind = 'ParentEventNotFoundError' as const
  constructor(public readonly eventId: string) {
    super(`Parent event not found: ${eventId}`)
    this.name = 'ParentEventNotFoundError'
    Object.setPrototypeOf(this, ParentEventNotFoundError.prototype)
  }
}
