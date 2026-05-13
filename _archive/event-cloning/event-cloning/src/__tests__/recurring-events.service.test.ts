import { describe, it, expect, vi, beforeEach } from 'vitest'
import { randomUUID } from 'crypto'
import {
  createRecurringSeries,
  generateOccurrences,
  generateAllSeries,
  deactivateSeries,
} from '../services/recurring-events.service.js'
import {
  InvalidRRuleError,
  ParentEventNotFoundError,
  SeriesNotFoundError,
  UnauthorizedCloneError,
} from '../types/cloning.types.js'
import type { DbAdapter } from '../types/cloning.types.js'

// ─── Test fixtures ────────────────────────────────────────────────────────────

const NOW = new Date('2026-04-06T09:00:00.000Z') // a Monday
const ORG = 'org-1'
const PARENT_ID = 'parent-evt-1'

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

interface OccurrenceRow {
  id: string
  series_id: string
  parent_event_id: string
  child_event_id: string
  occurrence_start: Date
  occurrence_end: Date
  status: string
  auto_published_at: Date | null
}

interface EventRow {
  id: string
  organizer_id: string
  venue_id: string | null
  title: string
  description: string | null
  category: string | null
  subcategory: string | null
  date_start: Date
  date_end: Date
  status: string
  capacity: number | null
  image_url: string | null
  on_sale_at: Date | null
  off_sale_at: Date | null
  resale_allowed: boolean
  resale_commission_rate: number | null
  re_entry_allowed: boolean
  zone_access_rules: unknown
  tags: string[]
  metadata: unknown
  created_at: Date
  updated_at: Date
  parent_event_id?: string | null
}

function makeParent(overrides: Partial<EventRow> = {}): EventRow {
  return {
    id: PARENT_ID,
    organizer_id: ORG,
    venue_id: 'venue-1',
    title: 'Pondělní kvíz',
    description: 'Each Monday',
    category: 'quiz',
    subcategory: null,
    // 2026-04-13 is a future Monday at 19:00 UTC (after NOW=2026-04-06)
    date_start: new Date('2026-04-13T19:00:00.000Z'),
    date_end: new Date('2026-04-13T21:00:00.000Z'),
    status: 'published',
    capacity: 100,
    image_url: null,
    on_sale_at: null,
    off_sale_at: null,
    resale_allowed: false,
    resale_commission_rate: null,
    re_entry_allowed: false,
    zone_access_rules: null,
    tags: [],
    metadata: null,
    created_at: new Date('2026-01-01'),
    updated_at: new Date('2026-01-01'),
    ...overrides,
  }
}

/**
 * Build an in-memory DbAdapter that simulates just enough of the schema for
 * recurring-events.service + cloneEvent to work.
 */
function makeFakeDb(opts: { parent?: EventRow | null } = {}): DbAdapter {
  const events = new Map<string, EventRow>()
  const series = new Map<string, SeriesRow>()
  const occurrences: OccurrenceRow[] = []

  if (opts.parent !== null) {
    const p = opts.parent ?? makeParent()
    events.set(p.id, p)
  }

  function matchEvent(sql: string): boolean {
    return /FROM catalog\.events/i.test(sql)
  }
  function matchSeries(sql: string): boolean {
    return /FROM platform\.recurring_series/i.test(sql)
  }
  function matchOccurrence(sql: string): boolean {
    return /FROM platform\.series_occurrences/i.test(sql)
  }

  const queryOne = vi.fn(async (sql: string, params: unknown[] = []) => {
    if (matchEvent(sql)) {
      const id = params[0] as string
      return (events.get(id) ?? null) as never
    }
    if (matchSeries(sql)) {
      const id = params[0] as string
      return (series.get(id) ?? null) as never
    }
    if (matchOccurrence(sql)) {
      if (/COUNT\(/i.test(sql)) {
        const seriesId = params[0] as string
        const count = occurrences.filter((o) => o.series_id === seriesId).length
        return { count } as never
      }
      const [parentId, occurrenceStart] = params as [string, Date]
      const t = new Date(occurrenceStart).getTime()
      const found = occurrences.find(
        (o) =>
          o.parent_event_id === parentId &&
          new Date(o.occurrence_start).getTime() === t,
      )
      return (found ?? null) as never
    }
    return null as never
  })

  const queryMany = vi.fn(async (sql: string, params: unknown[] = []) => {
    if (/FROM catalog\.ticket_types/i.test(sql)) return [] as never
    if (/FROM catalog\.pricing_rules/i.test(sql)) return [] as never
    if (matchSeries(sql)) {
      // SELECT id FROM platform.recurring_series WHERE is_active = TRUE
      return Array.from(series.values())
        .filter((s) => s.is_active)
        .map((s) => ({ id: s.id })) as never
    }
    if (matchOccurrence(sql)) {
      const seriesId = params[0] as string
      return occurrences
        .filter((o) => o.series_id === seriesId)
        .map((o) => ({
          child_event_id: o.child_event_id,
          series_id: o.series_id,
          parent_event_id: o.parent_event_id,
          occurrence_start: o.occurrence_start,
          occurrence_end: o.occurrence_end,
          status: o.status,
          auto_published_at: o.auto_published_at,
        })) as never
    }
    return [] as never
  })

  const execute = vi.fn(async (sql: string, params: unknown[] = []) => {
    if (/INSERT INTO catalog\.events/i.test(sql)) {
      // Mirror columns from event-cloning.service.ts INSERT order
      const [
        id,
        organizer_id,
        venue_id,
        title,
        description,
        category,
        subcategory,
        date_start,
        date_end,
        status,
        capacity,
        image_url,
        on_sale_at,
        off_sale_at,
        resale_allowed,
        resale_commission_rate,
        re_entry_allowed,
      ] = params as [
        string,
        string,
        string | null,
        string,
        string | null,
        string | null,
        string | null,
        Date,
        Date,
        string,
        number | null,
        string | null,
        Date | null,
        Date | null,
        boolean,
        number | null,
        boolean,
      ]
      events.set(id, {
        id,
        organizer_id,
        venue_id,
        title,
        description,
        category,
        subcategory,
        date_start,
        date_end,
        status: status as EventRow['status'],
        capacity,
        image_url,
        on_sale_at,
        off_sale_at,
        resale_allowed,
        resale_commission_rate,
        re_entry_allowed,
        zone_access_rules: null,
        tags: [],
        metadata: null,
        created_at: new Date(),
        updated_at: new Date(),
      })
      return { rowCount: 1 } as never
    }
    if (/UPDATE catalog\.events/i.test(sql)) {
      // either status update or parent_event_id update — both no-ops for tests
      return { rowCount: 1 } as never
    }
    if (/INSERT INTO platform\.recurring_series/i.test(sql)) {
      const [
        id,
        parent_event_id,
        organizer_id,
        rrule,
        publish_window_days,
        max_occurrences,
        initial_status,
      ] = params as [
        string,
        string,
        string,
        string,
        number,
        number | null,
        'draft' | 'published',
      ]
      series.set(id, {
        id,
        parent_event_id,
        organizer_id,
        rrule,
        publish_window_days,
        max_occurrences,
        initial_status,
        last_generated_at: null,
        last_generated_until: null,
        is_active: true,
        created_at: new Date(),
        updated_at: new Date(),
      })
      return { rowCount: 1 } as never
    }
    if (/UPDATE platform\.recurring_series/i.test(sql)) {
      if (/is_active = FALSE/i.test(sql)) {
        const id = params[0] as string
        const row = series.get(id)
        if (row !== undefined) row.is_active = false
        return { rowCount: 1 } as never
      }
      // last_generated_at update
      const [now, latestStart, id] = params as [Date, Date | null, string]
      const row = series.get(id)
      if (row !== undefined) {
        row.last_generated_at = now
        if (latestStart !== null) row.last_generated_until = latestStart
      }
      return { rowCount: 1 } as never
    }
    if (/INSERT INTO platform\.series_occurrences/i.test(sql)) {
      const [
        id,
        series_id,
        parent_event_id,
        child_event_id,
        occurrence_start,
        occurrence_end,
        status,
        auto_published_at,
      ] = params as [
        string,
        string,
        string,
        string,
        Date,
        Date,
        string,
        Date | null,
      ]
      occurrences.push({
        id,
        series_id,
        parent_event_id,
        child_event_id,
        occurrence_start,
        occurrence_end,
        status,
        auto_published_at,
      })
      return { rowCount: 1 } as never
    }
    return { rowCount: 0 } as never
  })

  const adapter: DbAdapter = {
    queryOne,
    queryMany,
    execute,
    transaction: async (fn) =>
      fn({
        queryOne,
        queryMany,
        execute,
      } as unknown as Parameters<typeof fn>[0]),
  } as unknown as DbAdapter

  // Expose internals for assertions
  ;(adapter as unknown as { __state: unknown }).__state = {
    events,
    series,
    occurrences,
  }
  return adapter
}

function getState(db: DbAdapter): {
  events: Map<string, EventRow>
  series: Map<string, SeriesRow>
  occurrences: OccurrenceRow[]
} {
  return (db as unknown as { __state: never }).__state as never
}

// ─── createRecurringSeries ────────────────────────────────────────────────────

describe('createRecurringSeries', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(NOW)
  })

  it('creates a series row for a valid RRULE', async () => {
    const db = makeFakeDb()
    const { series, firstBatch } = await createRecurringSeries(
      {
        parentEventId: PARENT_ID,
        rrule: 'FREQ=WEEKLY;BYDAY=MO;COUNT=4',
        publishWindowDays: 60,
      },
      ORG,
      db,
      NOW,
    )

    expect(series.id).toBeDefined()
    expect(series.parentEventId).toBe(PARENT_ID)
    expect(series.isActive).toBe(true)
    expect(firstBatch.seriesId).toBe(series.id)
    expect(firstBatch.generated).toBeGreaterThan(0)
  })

  it('throws InvalidRRuleError on a malformed RRULE', async () => {
    const db = makeFakeDb()
    await expect(
      createRecurringSeries(
        {
          parentEventId: PARENT_ID,
          rrule: 'this is not an rrule',
          publishWindowDays: 30,
        },
        ORG,
        db,
        NOW,
      ),
    ).rejects.toBeInstanceOf(InvalidRRuleError)
  })

  it('throws UnauthorizedCloneError when organizer does not own the parent', async () => {
    const db = makeFakeDb({ parent: makeParent({ organizer_id: 'someone-else' }) })
    await expect(
      createRecurringSeries(
        {
          parentEventId: PARENT_ID,
          rrule: 'FREQ=WEEKLY;BYDAY=MO;COUNT=2',
          publishWindowDays: 30,
        },
        ORG,
        db,
        NOW,
      ),
    ).rejects.toBeInstanceOf(UnauthorizedCloneError)
  })

  it('throws ParentEventNotFoundError when parent missing', async () => {
    const db = makeFakeDb({ parent: null })
    await expect(
      createRecurringSeries(
        {
          parentEventId: PARENT_ID,
          rrule: 'FREQ=WEEKLY;BYDAY=MO;COUNT=2',
          publishWindowDays: 30,
        },
        ORG,
        db,
        NOW,
      ),
    ).rejects.toBeInstanceOf(ParentEventNotFoundError)
  })
})

// ─── generateOccurrences ──────────────────────────────────────────────────────

describe('generateOccurrences', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(NOW)
  })

  async function createWith(
    db: DbAdapter,
    overrides: {
      rrule?: string
      publishWindowDays?: number
      maxOccurrences?: number
      initialStatus?: 'draft' | 'published'
    } = {},
  ) {
    return createRecurringSeries(
      {
        parentEventId: PARENT_ID,
        rrule: overrides.rrule ?? 'FREQ=WEEKLY;BYDAY=MO;COUNT=4',
        publishWindowDays: overrides.publishWindowDays ?? 60,
        maxOccurrences: overrides.maxOccurrences,
        initialStatus: overrides.initialStatus,
      },
      ORG,
      db,
      NOW,
    )
  }

  it('FREQ=WEEKLY;BYDAY=MO;COUNT=4 generates 4 occurrences across 4 weeks', async () => {
    const db = makeFakeDb()
    const { firstBatch } = await createWith(db, { publishWindowDays: 60 })
    expect(firstBatch.generated).toBe(4)
    const state = getState(db)
    expect(state.occurrences.length).toBe(4)
  })

  it('publishWindowDays=7 only materialises occurrences within 7 days', async () => {
    const db = makeFakeDb()
    // Parent first occurrence is exactly 7 days from NOW (2026-04-13).
    // With a 7-day window from NOW we expect just 1 occurrence.
    const { firstBatch } = await createWith(db, {
      publishWindowDays: 7,
      rrule: 'FREQ=WEEKLY;BYDAY=MO;COUNT=4',
    })
    expect(firstBatch.generated).toBe(1)
  })

  it('is idempotent — second call skips already-existing occurrences', async () => {
    const db = makeFakeDb()
    const { series, firstBatch } = await createWith(db, {
      publishWindowDays: 60,
    })
    expect(firstBatch.generated).toBe(4)

    // Reset last_generated_until so the rule re-scans the same window;
    // existing-row check should still skip them.
    const state = getState(db)
    const row = state.series.get(series.id)!
    row.last_generated_until = null

    const second = await generateOccurrences(series.id, db, NOW)
    expect(second.generated).toBe(0)
    expect(second.skipped).toBeGreaterThan(0)
  })

  it('honours maxOccurrences cap even if RRULE produces more', async () => {
    const db = makeFakeDb()
    const { firstBatch } = await createWith(db, {
      rrule: 'FREQ=WEEKLY;BYDAY=MO;COUNT=10',
      publishWindowDays: 365,
      maxOccurrences: 3,
    })
    expect(firstBatch.generated).toBe(3)
  })

  it('initial_status=published sets auto_published_at on the occurrence', async () => {
    const db = makeFakeDb()
    const { series } = await createWith(db, {
      rrule: 'FREQ=WEEKLY;BYDAY=MO;COUNT=2',
      publishWindowDays: 60,
      initialStatus: 'published',
    })
    const state = getState(db)
    const occs = state.occurrences.filter((o) => o.series_id === series.id)
    expect(occs.length).toBeGreaterThan(0)
    for (const o of occs) {
      expect(o.status).toBe('published')
      expect(o.auto_published_at).not.toBeNull()
    }
  })
})

// ─── deactivateSeries ─────────────────────────────────────────────────────────

describe('deactivateSeries', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(NOW)
  })

  it('marks is_active=false and subsequent generateOccurrences throws', async () => {
    const db = makeFakeDb()
    const { series } = await createRecurringSeries(
      {
        parentEventId: PARENT_ID,
        rrule: 'FREQ=WEEKLY;BYDAY=MO;COUNT=4',
        publishWindowDays: 60,
      },
      ORG,
      db,
      NOW,
    )

    const updated = await deactivateSeries(series.id, ORG, db)
    expect(updated.isActive).toBe(false)

    await expect(generateOccurrences(series.id, db, NOW)).rejects.toBeInstanceOf(
      SeriesNotFoundError,
    )
  })
})

// ─── generateAllSeries ────────────────────────────────────────────────────────

describe('generateAllSeries', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(NOW)
  })

  it('processes multiple series and continues when one fails', async () => {
    const db = makeFakeDb()
    const state = getState(db)

    // Create one healthy series
    await createRecurringSeries(
      {
        parentEventId: PARENT_ID,
        rrule: 'FREQ=WEEKLY;BYDAY=MO;COUNT=2',
        publishWindowDays: 60,
      },
      ORG,
      db,
      NOW,
    )

    // Inject a poisoned series row that points at a missing parent event
    const badId = randomUUID()
    state.series.set(badId, {
      id: badId,
      parent_event_id: 'missing-parent',
      organizer_id: ORG,
      rrule: 'FREQ=WEEKLY;BYDAY=MO;COUNT=2',
      publish_window_days: 60,
      max_occurrences: null,
      initial_status: 'draft',
      last_generated_at: null,
      last_generated_until: null,
      is_active: true,
      created_at: new Date(),
      updated_at: new Date(),
    })

    const result = await generateAllSeries(db, NOW)
    // The healthy one was processed; the bad one was caught & logged
    expect(result.seriesProcessed).toBe(1)
    expect(result.totalGenerated).toBeGreaterThan(0)
  })
})
