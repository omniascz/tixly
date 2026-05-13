// ─── Recurring events service ─────────────────────────────────────────────────
//
// Builds RFC 5545 RRULE-based recurring event series on top of cloneEvent.
// A "template" parent event is configured with a recurrence rule and a
// publish window; this service materialises concrete child events on a cron.
//
// Required schema (add via migration before deploying):
// CREATE TABLE platform.recurring_series (
//   id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
//   parent_event_id UUID NOT NULL REFERENCES catalog.events(id),
//   organizer_id UUID NOT NULL,
//   rrule TEXT NOT NULL,
//   publish_window_days INTEGER NOT NULL DEFAULT 30,
//   max_occurrences INTEGER,
//   initial_status TEXT NOT NULL DEFAULT 'draft' CHECK (initial_status IN ('draft','published')),
//   last_generated_at TIMESTAMPTZ,
//   last_generated_until TIMESTAMPTZ,
//   is_active BOOLEAN NOT NULL DEFAULT TRUE,
//   created_at TIMESTAMPTZ DEFAULT NOW(),
//   updated_at TIMESTAMPTZ DEFAULT NOW()
// );
// CREATE TABLE platform.series_occurrences (
//   id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
//   series_id UUID NOT NULL REFERENCES platform.recurring_series(id) ON DELETE CASCADE,
//   parent_event_id UUID NOT NULL,
//   child_event_id UUID NOT NULL REFERENCES catalog.events(id),
//   occurrence_start TIMESTAMPTZ NOT NULL,
//   occurrence_end TIMESTAMPTZ NOT NULL,
//   status TEXT NOT NULL,
//   auto_published_at TIMESTAMPTZ,
//   created_at TIMESTAMPTZ DEFAULT NOW(),
//   UNIQUE (parent_event_id, occurrence_start)
// );
// ALTER TABLE catalog.events ADD COLUMN parent_event_id UUID REFERENCES catalog.events(id);
// CREATE INDEX idx_events_parent ON catalog.events(parent_event_id);

import { randomUUID } from 'crypto'
import { RRule } from 'rrule'
import { cloneEvent } from './event-cloning.service.js'
import type {
  DbAdapter,
  Event,
  GenerateOccurrencesResult,
  RecurringSeries,
  RecurringSeriesConfig,
  SeriesOccurrence,
} from '../types/cloning.types.js'
import {
  InvalidRRuleError,
  ParentEventNotFoundError,
  SeriesNotFoundError,
  UnauthorizedCloneError,
} from '../types/cloning.types.js'

// ─── Internal row shapes ──────────────────────────────────────────────────────

interface SeriesRow {
  id: string
  parent_event_id: string
  organizer_id: string
  rrule: string
  publish_window_days: number
  max_occurrences: number | null
  initial_status: 'draft' | 'published'
  last_generated_at: Date | null
  last_generated_until: Date | null
  is_active: boolean
  created_at: Date
  updated_at: Date
}

function rowToSeries(row: SeriesRow): RecurringSeries {
  return {
    id: row.id,
    parentEventId: row.parent_event_id,
    rrule: row.rrule,
    publishWindowDays: row.publish_window_days,
    maxOccurrences: row.max_occurrences,
    initialStatus: row.initial_status,
    lastGeneratedAt: row.last_generated_at,
    lastGeneratedUntil: row.last_generated_until,
    isActive: row.is_active,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

// ─── RRULE helpers ────────────────────────────────────────────────────────────

/** Strip any DTSTART line from a user-supplied RRULE string. */
function normalizeRRule(rrule: string): string {
  return rrule
    .split(/\r?\n/)
    .filter((line) => !/^DTSTART/i.test(line.trim()))
    .map((line) => line.replace(/^RRULE:/i, ''))
    .join('\n')
    .trim()
}

/** Format a Date as iCalendar UTC timestamp: YYYYMMDDTHHMMSSZ */
function icalUtc(d: Date): string {
  const pad = (n: number, w = 2) => String(n).padStart(w, '0')
  return (
    `${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}` +
    `T${pad(d.getUTCHours())}${pad(d.getUTCMinutes())}${pad(d.getUTCSeconds())}Z`
  )
}

function buildRule(rruleString: string, dtstart: Date): RRule {
  const normalized = normalizeRRule(rruleString)
  try {
    // Validate normalized rule first (no DTSTART)
    RRule.fromString(`RRULE:${normalized}`)
  } catch (err) {
    throw new InvalidRRuleError(rruleString, err)
  }
  try {
    const full = `DTSTART:${icalUtc(dtstart)}\nRRULE:${normalized}`
    return RRule.fromString(full)
  } catch (err) {
    throw new InvalidRRuleError(rruleString, err)
  }
}

function addDays(date: Date, days: number): Date {
  return new Date(date.getTime() + days * 24 * 60 * 60 * 1000)
}

// ─── createRecurringSeries ────────────────────────────────────────────────────

/**
 * Create a recurring series. Validates the RRULE, inserts a row into
 * platform.recurring_series linked to the parent event, and immediately
 * generates the first batch of occurrences within the publishWindow.
 *
 * @throws {InvalidRRuleError}        — RRULE failed RFC 5545 parsing
 * @throws {ParentEventNotFoundError} — parent event does not exist
 * @throws {UnauthorizedCloneError}   — organizer does not own the parent
 */
export async function createRecurringSeries(
  config: RecurringSeriesConfig,
  organizerId: string,
  db: DbAdapter,
  now: Date = new Date(),
): Promise<{ series: RecurringSeries; firstBatch: GenerateOccurrencesResult }> {
  // Pre-validate RRULE without DTSTART so we fail fast.
  const normalized = normalizeRRule(config.rrule)
  try {
    RRule.fromString(`RRULE:${normalized}`)
  } catch (err) {
    throw new InvalidRRuleError(config.rrule, err)
  }

  return db.transaction(async (trx) => {
    const parent = await trx.queryOne<Event>(
      `SELECT id, organizer_id, date_start, date_end
         FROM catalog.events
        WHERE id = $1`,
      [config.parentEventId],
    )

    if (parent === null) {
      throw new ParentEventNotFoundError(config.parentEventId)
    }
    if (parent.organizer_id !== organizerId) {
      throw new UnauthorizedCloneError(config.parentEventId, organizerId)
    }

    const seriesId = randomUUID()
    const initialStatus = config.initialStatus ?? 'draft'
    const maxOccurrences = config.maxOccurrences ?? null

    await trx.execute(
      `INSERT INTO platform.recurring_series (
         id, parent_event_id, organizer_id, rrule, publish_window_days,
         max_occurrences, initial_status, last_generated_at,
         last_generated_until, is_active, created_at, updated_at
       ) VALUES (
         $1, $2, $3, $4, $5,
         $6, $7, NULL, NULL, TRUE, NOW(), NOW()
       )`,
      [
        seriesId,
        config.parentEventId,
        organizerId,
        normalized,
        config.publishWindowDays,
        maxOccurrences,
        initialStatus,
      ],
    )

    const firstBatch = await generateOccurrencesInternal(seriesId, trx, now)

    const refreshed = await trx.queryOne<SeriesRow>(
      `SELECT * FROM platform.recurring_series WHERE id = $1`,
      [seriesId],
    )
    if (refreshed === null) {
      throw new SeriesNotFoundError(seriesId)
    }

    return { series: rowToSeries(refreshed), firstBatch }
  })
}

// ─── generateOccurrences ──────────────────────────────────────────────────────

/**
 * Generate (and possibly publish) occurrences for a single series.
 * Idempotent: skips occurrences that already exist.
 *
 * @throws {SeriesNotFoundError} — series missing or is_active = false
 */
export async function generateOccurrences(
  seriesId: string,
  db: DbAdapter,
  now: Date = new Date(),
): Promise<GenerateOccurrencesResult> {
  return db.transaction((trx) => generateOccurrencesInternal(seriesId, trx, now))
}

async function generateOccurrencesInternal(
  seriesId: string,
  trx: Parameters<Parameters<DbAdapter['transaction']>[0]>[0],
  now: Date,
): Promise<GenerateOccurrencesResult> {
  const seriesRow = await trx.queryOne<SeriesRow>(
    `SELECT * FROM platform.recurring_series WHERE id = $1`,
    [seriesId],
  )
  if (seriesRow === null || seriesRow.is_active === false) {
    throw new SeriesNotFoundError(seriesId)
  }

  const parent = await trx.queryOne<Event>(
    `SELECT id, organizer_id, date_start, date_end
       FROM catalog.events
      WHERE id = $1`,
    [seriesRow.parent_event_id],
  )
  if (parent === null) {
    throw new ParentEventNotFoundError(seriesRow.parent_event_id)
  }

  const parentStart = new Date(parent.date_start)
  const parentEnd = new Date(parent.date_end)
  const durationMs = parentEnd.getTime() - parentStart.getTime()

  const rule = buildRule(seriesRow.rrule, parentStart)

  const horizon = addDays(now, seriesRow.publish_window_days)
  const windowStart = seriesRow.last_generated_until
    ? new Date(new Date(seriesRow.last_generated_until).getTime() + 1)
    : parentStart

  const occurrences = rule.between(windowStart, horizon, true)

  // Existing count for max_occurrences cap
  const existingCountRow = await trx.queryOne<{ count: number | string }>(
    `SELECT COUNT(*)::int AS count
       FROM platform.series_occurrences
      WHERE series_id = $1`,
    [seriesId],
  )
  let existingCount =
    existingCountRow !== null ? Number(existingCountRow.count) : 0

  let generated = 0
  let published = 0
  let skipped = 0
  let latestStart: Date | null = seriesRow.last_generated_until
    ? new Date(seriesRow.last_generated_until)
    : null

  for (const occurrenceStart of occurrences) {
    if (
      seriesRow.max_occurrences !== null &&
      existingCount >= seriesRow.max_occurrences
    ) {
      break
    }

    const existing = await trx.queryOne<{ id: string }>(
      `SELECT id FROM platform.series_occurrences
        WHERE parent_event_id = $1 AND occurrence_start = $2`,
      [seriesRow.parent_event_id, occurrenceStart],
    )
    if (existing !== null) {
      skipped++
      continue
    }

    const occurrenceEnd = new Date(occurrenceStart.getTime() + durationMs)

    // cloneEvent owns its own validation; future-date check is fine because
    // RRULE.between(now, horizon) only returns dates in [now, horizon].
    const cloneResult = await cloneEvent(
      seriesRow.parent_event_id,
      seriesRow.organizer_id,
      {
        newDateStart: occurrenceStart,
        newDateEnd: occurrenceEnd,
      },
      // Pass the in-flight transaction as a "db" so cloneEvent reuses it.
      // The trx adapter exposes the same transaction() contract.
      wrapTrxAsDb(trx),
    )

    // If the series wants published children, flip the status now.
    const willPublish = seriesRow.initial_status === 'published'
    if (willPublish) {
      await trx.execute(
        `UPDATE catalog.events
            SET status = 'published', updated_at = NOW()
          WHERE id = $1`,
        [cloneResult.newEventId],
      )
    }

    // Mark child's parent_event_id link
    await trx.execute(
      `UPDATE catalog.events
          SET parent_event_id = $1
        WHERE id = $2`,
      [seriesRow.parent_event_id, cloneResult.newEventId],
    )

    await trx.execute(
      `INSERT INTO platform.series_occurrences (
         id, series_id, parent_event_id, child_event_id,
         occurrence_start, occurrence_end, status, auto_published_at,
         created_at
       ) VALUES (
         $1, $2, $3, $4, $5, $6, $7, $8, NOW()
       )`,
      [
        randomUUID(),
        seriesId,
        seriesRow.parent_event_id,
        cloneResult.newEventId,
        occurrenceStart,
        occurrenceEnd,
        willPublish ? 'published' : 'draft',
        willPublish ? now : null,
      ],
    )

    generated++
    existingCount++
    if (willPublish) published++
    if (latestStart === null || occurrenceStart > latestStart) {
      latestStart = occurrenceStart
    }
  }

  await trx.execute(
    `UPDATE platform.recurring_series
        SET last_generated_at = $1,
            last_generated_until = COALESCE($2, last_generated_until),
            updated_at = NOW()
      WHERE id = $3`,
    [now, latestStart, seriesId],
  )

  return {
    seriesId,
    generated,
    published,
    skipped,
    nextRunAt: horizon,
  }
}

/**
 * Wrap a transaction handle so it satisfies the DbAdapter interface — needed
 * because cloneEvent calls db.transaction(...) internally. We pass through to
 * the same trx so the work stays inside the outer transaction.
 */
function wrapTrxAsDb(
  trx: Parameters<Parameters<DbAdapter['transaction']>[0]>[0],
): DbAdapter {
  return {
    queryOne: trx.queryOne.bind(trx),
    queryMany: trx.queryMany.bind(trx),
    execute: trx.execute.bind(trx),
    transaction: async (fn) => fn(trx),
  } as unknown as DbAdapter
}

// ─── generateAllSeries ────────────────────────────────────────────────────────

/**
 * Cron entry point — iterates all active series and calls generateOccurrences.
 * Per-series failures are caught and logged so one bad series cannot break the
 * batch.
 */
export async function generateAllSeries(
  db: DbAdapter,
  now: Date = new Date(),
): Promise<{
  seriesProcessed: number
  totalGenerated: number
  totalPublished: number
}> {
  const rows = await db.queryMany<{ id: string }>(
    `SELECT id FROM platform.recurring_series WHERE is_active = TRUE`,
    [],
  )

  let seriesProcessed = 0
  let totalGenerated = 0
  let totalPublished = 0

  for (const row of rows) {
    try {
      const result = await generateOccurrences(row.id, db, now)
      seriesProcessed++
      totalGenerated += result.generated
      totalPublished += result.published
    } catch (err) {
      console.error(
        `[generateAllSeries] series ${row.id} failed:`,
        err instanceof Error ? err.message : err,
      )
    }
  }

  return { seriesProcessed, totalGenerated, totalPublished }
}

// ─── deactivateSeries ─────────────────────────────────────────────────────────

/**
 * Stop a series. Existing child events are NOT deleted.
 *
 * @throws {SeriesNotFoundError}      — series missing
 * @throws {UnauthorizedCloneError}   — organizer does not own the series
 */
export async function deactivateSeries(
  seriesId: string,
  organizerId: string,
  db: DbAdapter,
): Promise<RecurringSeries> {
  return db.transaction(async (trx) => {
    const row = await trx.queryOne<SeriesRow>(
      `SELECT * FROM platform.recurring_series WHERE id = $1`,
      [seriesId],
    )
    if (row === null) {
      throw new SeriesNotFoundError(seriesId)
    }
    if (row.organizer_id !== organizerId) {
      throw new UnauthorizedCloneError(row.parent_event_id, organizerId)
    }

    await trx.execute(
      `UPDATE platform.recurring_series
          SET is_active = FALSE, updated_at = NOW()
        WHERE id = $1`,
      [seriesId],
    )

    const refreshed = await trx.queryOne<SeriesRow>(
      `SELECT * FROM platform.recurring_series WHERE id = $1`,
      [seriesId],
    )
    return rowToSeries(refreshed as SeriesRow)
  })
}

// ─── getSeriesWithOccurrences ─────────────────────────────────────────────────

/**
 * Load a series and all its occurrences (for promoter UI).
 *
 * @throws {SeriesNotFoundError}    — series missing
 * @throws {UnauthorizedCloneError} — organizer does not own the series
 */
export async function getSeriesWithOccurrences(
  seriesId: string,
  organizerId: string,
  db: DbAdapter,
): Promise<{ series: RecurringSeries; occurrences: SeriesOccurrence[] }> {
  const row = await db.queryOne<SeriesRow>(
    `SELECT * FROM platform.recurring_series WHERE id = $1`,
    [seriesId],
  )
  if (row === null) {
    throw new SeriesNotFoundError(seriesId)
  }
  if (row.organizer_id !== organizerId) {
    throw new UnauthorizedCloneError(row.parent_event_id, organizerId)
  }

  const occRows = await db.queryMany<{
    child_event_id: string
    series_id: string
    parent_event_id: string
    occurrence_start: Date
    occurrence_end: Date
    status: 'draft' | 'published' | 'cancelled'
    auto_published_at: Date | null
  }>(
    `SELECT child_event_id, series_id, parent_event_id, occurrence_start,
            occurrence_end, status, auto_published_at
       FROM platform.series_occurrences
      WHERE series_id = $1
      ORDER BY occurrence_start ASC`,
    [seriesId],
  )

  const occurrences: SeriesOccurrence[] = occRows.map((o) => ({
    childEventId: o.child_event_id,
    seriesId: o.series_id,
    parentEventId: o.parent_event_id,
    occurrenceStart: o.occurrence_start,
    occurrenceEnd: o.occurrence_end,
    status: o.status,
    autoPublishedAt: o.auto_published_at,
  }))

  return { series: rowToSeries(row), occurrences }
}
