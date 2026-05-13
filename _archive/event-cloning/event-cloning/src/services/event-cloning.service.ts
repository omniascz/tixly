import { randomUUID } from 'crypto'
import type {
  CloneEventOptions,
  CloneEventResult,
  DbAdapter,
  Event,
  PricingRule,
  TicketType,
} from '../types/cloning.types'
import {
  CloneValidationError,
  EventNotFoundError,
  UnauthorizedCloneError,
} from '../types/cloning.types'
import {
  generateCloneWarnings,
  sanitizeClonedEvent,
  sanitizeClonedTicketType,
  validateCloneOptions,
  validateSeriesDates,
  MAX_SERIES_CLONES,
} from '../lib/clone-validator'

// ─── cloneEvent ───────────────────────────────────────────────────────────────

/**
 * Clone a single event.
 *
 * The entire operation runs inside one DB transaction (atomic).
 * On error the transaction is rolled back and the typed error is re-thrown.
 *
 * @throws {CloneValidationError}   — invalid options
 * @throws {EventNotFoundError}     — event does not exist
 * @throws {UnauthorizedCloneError} — organiser does not own the event
 */
export async function cloneEvent(
  eventId: string,
  organizerId: string,
  options: CloneEventOptions,
  db: DbAdapter,
): Promise<CloneEventResult> {
  // ── 1. Validate options before touching the DB ────────────────────────────
  const validationErrors = validateCloneOptions(options)
  if (validationErrors.length > 0) {
    throw new CloneValidationError(validationErrors)
  }

  return db.transaction(async (trx) => {
    // ── 2. Fetch original event ─────────────────────────────────────────────
    const original = await trx.queryOne<Event>(
      `SELECT
         id, organizer_id, venue_id, title, description, category,
         subcategory, date_start, date_end, status, capacity, image_url,
         on_sale_at, off_sale_at, resale_allowed, resale_commission_rate,
         re_entry_allowed, zone_access_rules, tags, metadata,
         created_at, updated_at
       FROM catalog.events
       WHERE id = $1`,
      [eventId],
    )

    if (original === null) {
      throw new EventNotFoundError(eventId)
    }

    // ── 3. Authorisation check ──────────────────────────────────────────────
    if (original.organizer_id !== organizerId) {
      throw new UnauthorizedCloneError(eventId, organizerId)
    }

    // ── 4. Build warnings ───────────────────────────────────────────────────
    const warnings = generateCloneWarnings(original, options)

    // ── 5. INSERT new event ─────────────────────────────────────────────────
    const sanitizedEvent = sanitizeClonedEvent(original, options)
    const newEventId = randomUUID()

    await trx.execute<Event>(
      `INSERT INTO catalog.events (
         id, organizer_id, venue_id, title, description, category,
         subcategory, date_start, date_end, status, capacity, image_url,
         on_sale_at, off_sale_at, resale_allowed, resale_commission_rate,
         re_entry_allowed, zone_access_rules, tags, metadata,
         created_at, updated_at
       ) VALUES (
         $1,  $2,  $3,  $4,  $5,  $6,
         $7,  $8,  $9,  $10, $11, $12,
         $13, $14, $15, $16,
         $17, $18, $19, $20,
         NOW(), NOW()
       )`,
      [
        newEventId,
        sanitizedEvent.organizer_id,
        sanitizedEvent.venue_id,
        sanitizedEvent.title,
        sanitizedEvent.description,
        sanitizedEvent.category,
        sanitizedEvent.subcategory,
        sanitizedEvent.date_start,
        sanitizedEvent.date_end,
        sanitizedEvent.status,
        sanitizedEvent.capacity,
        sanitizedEvent.image_url,
        sanitizedEvent.on_sale_at,
        sanitizedEvent.off_sale_at,
        sanitizedEvent.resale_allowed,
        sanitizedEvent.resale_commission_rate,
        sanitizedEvent.re_entry_allowed,
        sanitizedEvent.zone_access_rules
          ? JSON.stringify(sanitizedEvent.zone_access_rules)
          : null,
        sanitizedEvent.tags,
        sanitizedEvent.metadata
          ? JSON.stringify(sanitizedEvent.metadata)
          : null,
      ],
    )

    // ── 6. Clone ticket types (and their pricing rules) ─────────────────────
    const shouldCloneTicketTypes = options.cloneTicketTypes !== false
    const shouldClonePricingRules =
      shouldCloneTicketTypes &&
      options.clonePricingRules !== false &&
      options.resetPricing !== true

    let clonedTicketTypes = 0
    let clonedPricingRules = 0

    if (shouldCloneTicketTypes) {
      const originalTicketTypes = await trx.queryMany<TicketType>(
        `SELECT
           id, event_id, name, kind, base_price, total_qty, remaining_qty,
           max_per_user, sale_start_at, sale_end_at, zone_id, is_active,
           created_at, updated_at
         FROM catalog.ticket_types
         WHERE event_id = $1`,
        [eventId],
      )

      for (const originalTT of originalTicketTypes) {
        const sanitizedTT = sanitizeClonedTicketType(originalTT)
        const newTTId = randomUUID()

        await trx.execute<TicketType>(
          `INSERT INTO catalog.ticket_types (
             id, event_id, name, kind, base_price, total_qty, remaining_qty,
             max_per_user, sale_start_at, sale_end_at, zone_id, is_active,
             created_at, updated_at
           ) VALUES (
             $1,  $2,  $3,  $4,  $5,  $6,  $7,
             $8,  $9,  $10, $11, $12,
             NOW(), NOW()
           )`,
          [
            newTTId,
            newEventId,
            sanitizedTT.name,
            sanitizedTT.kind,
            sanitizedTT.base_price,
            sanitizedTT.total_qty,
            sanitizedTT.remaining_qty,
            sanitizedTT.max_per_user,
            sanitizedTT.sale_start_at,
            sanitizedTT.sale_end_at,
            sanitizedTT.zone_id,
            sanitizedTT.is_active,
          ],
        )

        clonedTicketTypes++

        // ── 7. Clone pricing rules for this ticket type ───────────────────
        if (shouldClonePricingRules) {
          const originalRules = await trx.queryMany<PricingRule>(
            `SELECT
               id, ticket_type_id, phase, threshold_qty, threshold_date,
               price, demand_factor, min_price, max_price,
               created_at, updated_at
             FROM catalog.pricing_rules
             WHERE ticket_type_id = $1`,
            [originalTT.id],
          )

          for (const rule of originalRules) {
            const newRuleId = randomUUID()

            await trx.execute<PricingRule>(
              `INSERT INTO catalog.pricing_rules (
                 id, ticket_type_id, phase, threshold_qty, threshold_date,
                 price, demand_factor, min_price, max_price,
                 created_at, updated_at
               ) VALUES (
                 $1, $2, $3, $4, $5,
                 $6, $7, $8, $9,
                 NOW(), NOW()
               )`,
              [
                newRuleId,
                newTTId,
                rule.phase,
                rule.threshold_qty,
                rule.threshold_date,
                rule.price,
                rule.demand_factor,
                rule.min_price,
                rule.max_price,
              ],
            )

            clonedPricingRules++
          }
        }
      }
    }

    return {
      originalEventId: eventId,
      newEventId,
      clonedTicketTypes,
      clonedPricingRules,
      warnings,
    }
  })
}

// ─── cloneEventSeries ─────────────────────────────────────────────────────────

type SeriesDate = { dateStart: Date; dateEnd: Date }

type FailedClone = { dateStart: string; error: string }

export type CloneSeriesResult = {
  created: CloneEventResult[]
  failed: FailedClone[]
  total: number
  succeeded: number
}

/**
 * Clone the same event for multiple dates (e.g. a whole theatre season).
 *
 * Rules:
 * - Max {@link MAX_SERIES_CLONES} dates per call.
 * - One DB transaction per clone — failure of one date does not block others.
 * - Uses Promise.allSettled so every date is attempted.
 *
 * @throws {CloneValidationError} — when the dates array itself is invalid
 *                                  (empty, too long, bad individual entries)
 */
export async function cloneEventSeries(
  eventId: string,
  organizerId: string,
  dates: SeriesDate[],
  options: Omit<CloneEventOptions, 'newDateStart' | 'newDateEnd'>,
  db: DbAdapter,
): Promise<CloneSeriesResult> {
  // Validate the series dates up-front (fast-fail before any DB work)
  const dateErrors = validateSeriesDates(dates)
  if (dateErrors.length > 0) {
    throw new CloneValidationError(dateErrors)
  }

  // Clamp to MAX_SERIES_CLONES as a safety net (validateSeriesDates already
  // rejects arrays larger than the limit, but belt-and-suspenders here)
  const safeDates = dates.slice(0, MAX_SERIES_CLONES)

  const clonePromises = safeDates.map(({ dateStart, dateEnd }) =>
    cloneEvent(
      eventId,
      organizerId,
      { ...options, newDateStart: dateStart, newDateEnd: dateEnd },
      db,
    ),
  )

  const settlements = await Promise.allSettled(clonePromises)

  const created: CloneEventResult[] = []
  const failed: FailedClone[] = []

  settlements.forEach((settlement, index) => {
    const { dateStart } = safeDates[index]
    if (settlement.status === 'fulfilled') {
      created.push(settlement.value)
    } else {
      failed.push({
        dateStart: dateStart.toISOString(),
        error:
          settlement.reason instanceof Error
            ? settlement.reason.message
            : String(settlement.reason),
      })
    }
  })

  return {
    created,
    failed,
    total: safeDates.length,
    succeeded: created.length,
  }
}
