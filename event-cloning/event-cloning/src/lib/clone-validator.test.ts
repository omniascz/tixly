import { describe, it, expect } from 'vitest'
import {
  validateCloneOptions,
  validateSeriesDates,
  sanitizeClonedEvent,
  sanitizeClonedTicketType,
  generateCloneWarnings,
  MAX_SERIES_CLONES,
} from './clone-validator'
import type { Event, TicketType, CloneEventOptions } from '../types/cloning.types'

// ─── Helpers ──────────────────────────────────────────────────────────────────

const NOW = new Date('2026-04-04T12:00:00.000Z')

const future = (offsetMs: number): Date =>
  new Date(NOW.getTime() + offsetMs)

const past = (offsetMs: number): Date =>
  new Date(NOW.getTime() - offsetMs)

const DAY = 24 * 60 * 60 * 1000

function makeEvent(overrides: Partial<Event> = {}): Event {
  return {
    id: 'evt-1',
    organizer_id: 'org-1',
    venue_id: 'venue-1',
    title: 'Hamlet',
    description: 'Divadelní hra',
    category: 'divadlo',
    subcategory: null,
    date_start: past(7 * DAY),
    date_end: past(6 * DAY),
    status: 'published',
    capacity: 500,
    image_url: 'https://example.com/hamlet.jpg',
    on_sale_at: past(14 * DAY),
    off_sale_at: past(1 * DAY),
    resale_allowed: true,
    resale_commission_rate: 0.1,
    re_entry_allowed: false,
    zone_access_rules: { VIP: ['zone-a'], standard: ['zone-b'] },
    tags: ['drama', 'shakespeare'],
    metadata: { language: 'cs' },
    created_at: past(30 * DAY),
    updated_at: past(7 * DAY),
    ...overrides,
  }
}

function makeTicketType(overrides: Partial<TicketType> = {}): TicketType {
  return {
    id: 'tt-1',
    event_id: 'evt-1',
    name: 'Standardní',
    kind: 'seated',
    base_price: 350,
    total_qty: 400,
    remaining_qty: 120,
    max_per_user: 4,
    sale_start_at: past(14 * DAY),
    sale_end_at: past(1 * DAY),
    zone_id: 'zone-b',
    is_active: true,
    created_at: past(30 * DAY),
    updated_at: past(7 * DAY),
    ...overrides,
  }
}

function makeOptions(overrides: Partial<CloneEventOptions> = {}): CloneEventOptions {
  return {
    newDateStart: future(30 * DAY),
    newDateEnd: future(30 * DAY + 3 * 60 * 60 * 1000), // +3 h
    ...overrides,
  }
}

// ─── validateCloneOptions ─────────────────────────────────────────────────────

describe('validateCloneOptions', () => {
  it('returns empty array for fully valid options', () => {
    const errors = validateCloneOptions(makeOptions(), NOW)
    expect(errors).toEqual([])
  })

  it('reports error when newDateStart is in the past', () => {
    const errors = validateCloneOptions(
      makeOptions({ newDateStart: past(1 * DAY), newDateEnd: future(1 * DAY) }),
      NOW,
    )
    expect(errors.some((e) => e.includes('newDateStart'))).toBe(true)
  })

  it('reports error when newDateStart equals NOW (not strictly future)', () => {
    const errors = validateCloneOptions(
      makeOptions({ newDateStart: NOW, newDateEnd: future(1 * DAY) }),
      NOW,
    )
    expect(errors.some((e) => e.includes('newDateStart'))).toBe(true)
  })

  it('reports error when newDateEnd is before newDateStart', () => {
    const errors = validateCloneOptions(
      makeOptions({
        newDateStart: future(2 * DAY),
        newDateEnd: future(1 * DAY),
      }),
      NOW,
    )
    expect(errors.some((e) => e.includes('newDateEnd'))).toBe(true)
  })

  it('reports error when newDateEnd equals newDateStart', () => {
    const start = future(2 * DAY)
    const errors = validateCloneOptions(
      makeOptions({ newDateStart: start, newDateEnd: start }),
      NOW,
    )
    expect(errors.some((e) => e.includes('newDateEnd'))).toBe(true)
  })

  it('reports error when offSaleAt is before onSaleAt', () => {
    const errors = validateCloneOptions(
      makeOptions({
        onSaleAt: future(10 * DAY),
        offSaleAt: future(5 * DAY),
      }),
      NOW,
    )
    expect(errors.some((e) => e.includes('offSaleAt'))).toBe(true)
  })

  it('reports error when onSaleAt is after or equal to newDateStart', () => {
    const start = future(10 * DAY)
    const errors = validateCloneOptions(
      makeOptions({
        newDateStart: start,
        newDateEnd: future(11 * DAY),
        onSaleAt: start,
      }),
      NOW,
    )
    expect(errors.some((e) => e.includes('onSaleAt'))).toBe(true)
  })

  it('reports error when clonePricingRules=true but cloneTicketTypes=false', () => {
    const errors = validateCloneOptions(
      makeOptions({ cloneTicketTypes: false, clonePricingRules: true }),
      NOW,
    )
    expect(errors.some((e) => e.includes('clonePricingRules'))).toBe(true)
  })

  it('reports error when newTitle is an empty string', () => {
    const errors = validateCloneOptions(makeOptions({ newTitle: '  ' }), NOW)
    expect(errors.some((e) => e.includes('newTitle'))).toBe(true)
  })

  it('allows cloneTicketTypes=false without clonePricingRules set', () => {
    const errors = validateCloneOptions(
      makeOptions({ cloneTicketTypes: false }),
      NOW,
    )
    expect(errors.filter((e) => e.includes('clonePricingRules'))).toHaveLength(0)
  })

  it('accumulates multiple errors', () => {
    const errors = validateCloneOptions(
      makeOptions({
        newDateStart: past(1 * DAY),
        newDateEnd: past(2 * DAY),
        newTitle: '',
      }),
      NOW,
    )
    expect(errors.length).toBeGreaterThanOrEqual(3)
  })
})

// ─── sanitizeClonedEvent ──────────────────────────────────────────────────────

describe('sanitizeClonedEvent', () => {
  it('status is always draft', () => {
    const result = sanitizeClonedEvent(makeEvent({ status: 'published' }), makeOptions())
    expect(result.status).toBe('draft')
  })

  it('appends "(kopie)" to title when newTitle is not provided', () => {
    const result = sanitizeClonedEvent(makeEvent({ title: 'Hamlet' }), makeOptions())
    expect(result.title).toBe('Hamlet (kopie)')
  })

  it('uses custom newTitle when provided', () => {
    const result = sanitizeClonedEvent(
      makeEvent({ title: 'Hamlet' }),
      makeOptions({ newTitle: 'Hamlet — premiéra' }),
    )
    expect(result.title).toBe('Hamlet — premiéra')
  })

  it('sets date_start from options.newDateStart', () => {
    const start = future(30 * DAY)
    const result = sanitizeClonedEvent(makeEvent(), makeOptions({ newDateStart: start }))
    expect(result.date_start).toBe(start)
  })

  it('sets date_end from options.newDateEnd', () => {
    const end = future(31 * DAY)
    const result = sanitizeClonedEvent(makeEvent(), makeOptions({ newDateEnd: end }))
    expect(result.date_end).toBe(end)
  })

  it('sets on_sale_at from options when provided', () => {
    const saleAt = future(5 * DAY)
    const result = sanitizeClonedEvent(makeEvent(), makeOptions({ onSaleAt: saleAt }))
    expect(result.on_sale_at).toBe(saleAt)
  })

  it('resets on_sale_at to null when not provided in options', () => {
    const result = sanitizeClonedEvent(makeEvent(), makeOptions())
    expect(result.on_sale_at).toBeNull()
  })

  it('resets off_sale_at to null when not provided in options', () => {
    const result = sanitizeClonedEvent(makeEvent(), makeOptions())
    expect(result.off_sale_at).toBeNull()
  })

  it('preserves organizer_id from original', () => {
    const result = sanitizeClonedEvent(makeEvent({ organizer_id: 'org-42' }), makeOptions())
    expect(result.organizer_id).toBe('org-42')
  })

  it('deep-copies tags array so mutations do not affect original', () => {
    const original = makeEvent({ tags: ['drama', 'shakespeare'] })
    const result = sanitizeClonedEvent(original, makeOptions())
    ;(result.tags as string[]).push('mutated')
    expect(original.tags).not.toContain('mutated')
  })

  it('preserves resale settings from original', () => {
    const result = sanitizeClonedEvent(
      makeEvent({ resale_allowed: true, resale_commission_rate: 0.15 }),
      makeOptions(),
    )
    expect(result.resale_allowed).toBe(true)
    expect(result.resale_commission_rate).toBe(0.15)
  })
})

// ─── sanitizeClonedTicketType ─────────────────────────────────────────────────

describe('sanitizeClonedTicketType', () => {
  it('resets remaining_qty to total_qty', () => {
    const tt = makeTicketType({ total_qty: 400, remaining_qty: 120 })
    const result = sanitizeClonedTicketType(tt)
    expect(result.remaining_qty).toBe(400)
  })

  it('resets sale_start_at to null', () => {
    const result = sanitizeClonedTicketType(makeTicketType())
    expect(result.sale_start_at).toBeNull()
  })

  it('resets sale_end_at to null', () => {
    const result = sanitizeClonedTicketType(makeTicketType())
    expect(result.sale_end_at).toBeNull()
  })

  it('does not include event_id in the result', () => {
    const result = sanitizeClonedTicketType(makeTicketType())
    expect('event_id' in result).toBe(false)
  })

  it('preserves base_price from original', () => {
    const result = sanitizeClonedTicketType(makeTicketType({ base_price: 550 }))
    expect(result.base_price).toBe(550)
  })

  it('preserves zone_id from original', () => {
    const result = sanitizeClonedTicketType(makeTicketType({ zone_id: 'zone-vip' }))
    expect(result.zone_id).toBe('zone-vip')
  })

  it('preserves max_per_user from original', () => {
    const result = sanitizeClonedTicketType(makeTicketType({ max_per_user: 6 }))
    expect(result.max_per_user).toBe(6)
  })
})

// ─── generateCloneWarnings ────────────────────────────────────────────────────

describe('generateCloneWarnings', () => {
  it('returns empty array for a clean clone', () => {
    const warnings = generateCloneWarnings(
      makeEvent({ on_sale_at: null, off_sale_at: null, status: 'published' }),
      makeOptions(),
      NOW,
    )
    expect(warnings).toEqual([])
  })

  it('warns when original on_sale_at was in the past', () => {
    const warnings = generateCloneWarnings(
      makeEvent({ on_sale_at: past(5 * DAY) }),
      makeOptions(),
      NOW,
    )
    expect(warnings.some((w) => w.includes('on_sale_at'))).toBe(true)
  })

  it('warns when original off_sale_at was in the past', () => {
    const warnings = generateCloneWarnings(
      makeEvent({ off_sale_at: past(1 * DAY) }),
      makeOptions(),
      NOW,
    )
    expect(warnings.some((w) => w.includes('off_sale_at'))).toBe(true)
  })

  it('warns when resetPricing=true', () => {
    const warnings = generateCloneWarnings(
      makeEvent({ on_sale_at: null, off_sale_at: null }),
      makeOptions({ resetPricing: true }),
      NOW,
    )
    expect(warnings.some((w) => w.includes('resetPricing'))).toBe(true)
  })

  it('warns when cloneTicketTypes=false', () => {
    const warnings = generateCloneWarnings(
      makeEvent({ on_sale_at: null, off_sale_at: null }),
      makeOptions({ cloneTicketTypes: false }),
      NOW,
    )
    expect(warnings.some((w) => w.includes('cloneTicketTypes'))).toBe(true)
  })

  it('warns when the original event was cancelled', () => {
    const warnings = generateCloneWarnings(
      makeEvent({ status: 'cancelled', on_sale_at: null, off_sale_at: null }),
      makeOptions(),
      NOW,
    )
    expect(warnings.some((w) => w.includes('cancelled'))).toBe(true)
  })

  it('warns when the original event was postponed', () => {
    const warnings = generateCloneWarnings(
      makeEvent({ status: 'postponed', on_sale_at: null, off_sale_at: null }),
      makeOptions(),
      NOW,
    )
    expect(warnings.some((w) => w.includes('postponed'))).toBe(true)
  })

  it('warns when provided onSaleAt is in the past', () => {
    const warnings = generateCloneWarnings(
      makeEvent({ on_sale_at: null, off_sale_at: null }),
      makeOptions({ onSaleAt: past(1 * DAY) }),
      NOW,
    )
    expect(warnings.some((w) => w.includes('onSaleAt'))).toBe(true)
  })
})

// ─── validateSeriesDates ──────────────────────────────────────────────────────

describe('validateSeriesDates', () => {
  it('returns empty array for valid dates', () => {
    const dates = [
      { dateStart: future(10 * DAY), dateEnd: future(10 * DAY + 3600_000) },
      { dateStart: future(20 * DAY), dateEnd: future(20 * DAY + 3600_000) },
    ]
    expect(validateSeriesDates(dates, NOW)).toEqual([])
  })

  it('reports error when dates array is empty', () => {
    const errors = validateSeriesDates([], NOW)
    expect(errors.length).toBeGreaterThan(0)
  })

  it(`reports error when dates array exceeds ${MAX_SERIES_CLONES}`, () => {
    const dates = Array.from({ length: MAX_SERIES_CLONES + 1 }, (_, i) => ({
      dateStart: future((i + 1) * DAY),
      dateEnd: future((i + 1) * DAY + 3600_000),
    }))
    const errors = validateSeriesDates(dates, NOW)
    expect(errors.some((e) => e.includes(String(MAX_SERIES_CLONES)))).toBe(true)
  })

  it('reports error for a date in the past within the series', () => {
    const dates = [
      { dateStart: past(1 * DAY), dateEnd: past(1 * DAY - 3600_000) },
    ]
    const errors = validateSeriesDates(dates, NOW)
    expect(errors.some((e) => e.includes('dates[0]'))).toBe(true)
  })

  it('reports error when dateEnd is before dateStart within a series entry', () => {
    const dates = [
      { dateStart: future(10 * DAY), dateEnd: future(9 * DAY) },
    ]
    const errors = validateSeriesDates(dates, NOW)
    expect(errors.some((e) => e.includes('dateEnd'))).toBe(true)
  })

  it('accepts exactly MAX_SERIES_CLONES dates without error', () => {
    const dates = Array.from({ length: MAX_SERIES_CLONES }, (_, i) => ({
      dateStart: future((i + 1) * DAY),
      dateEnd: future((i + 1) * DAY + 3600_000),
    }))
    expect(validateSeriesDates(dates, NOW)).toEqual([])
  })
})

// ─── Extended Coverage: Clone Reset States & Configuration Copying ─────────

describe('sanitizeClonedEvent — clone resets sold_count to 0', () => {
  it('cloned event inherits all properties except dates, status, and sales', () => {
    const original = makeEvent({
      title: 'Original Event',
      description: 'Test description',
      category: 'music',
      capacity: 500,
      tags: ['festival', 'summer'],
    })
    const result = sanitizeClonedEvent(original, makeOptions())
    expect(result.title).toBe('Original Event (kopie)')
    expect(result.description).toBe('Test description')
    expect(result.category).toBe('music')
    expect(result.capacity).toBe(500)
  })

  it('cloned event sets status=draft regardless of original status', () => {
    const published = sanitizeClonedEvent(makeEvent({ status: 'published' }), makeOptions())
    const draft = sanitizeClonedEvent(makeEvent({ status: 'draft' }), makeOptions())
    const cancelled = sanitizeClonedEvent(makeEvent({ status: 'cancelled' }), makeOptions())

    expect(published.status).toBe('draft')
    expect(draft.status).toBe('draft')
    expect(cancelled.status).toBe('draft')
  })

  it('cloned event resets sale windows when not provided in options', () => {
    const original = makeEvent({
      on_sale_at: past(14 * DAY),
      off_sale_at: past(1 * DAY),
    })
    const result = sanitizeClonedEvent(original, makeOptions())
    expect(result.on_sale_at).toBeNull()
    expect(result.off_sale_at).toBeNull()
  })

  it('cloned event uses custom title when provided', () => {
    const result = sanitizeClonedEvent(
      makeEvent({ title: 'Original' }),
      makeOptions({ newTitle: 'Custom Title' })
    )
    expect(result.title).toBe('Custom Title')
  })
})

describe('sanitizeClonedTicketType — copy ticket types & pricing', () => {
  it('cloned ticket type resets remaining_qty to total_qty', () => {
    const original = makeTicketType({ total_qty: 500, remaining_qty: 125 })
    const result = sanitizeClonedTicketType(original)
    expect(result.remaining_qty).toBe(500)
  })

  it('cloned ticket type clears sale_start_at', () => {
    const original = makeTicketType({ sale_start_at: past(7 * DAY) })
    const result = sanitizeClonedTicketType(original)
    expect(result.sale_start_at).toBeNull()
  })

  it('cloned ticket type clears sale_end_at', () => {
    const original = makeTicketType({ sale_end_at: past(1 * DAY) })
    const result = sanitizeClonedTicketType(original)
    expect(result.sale_end_at).toBeNull()
  })

  it('cloned ticket type preserves base_price', () => {
    const original = makeTicketType({ base_price: 750 })
    const result = sanitizeClonedTicketType(original)
    expect(result.base_price).toBe(750)
  })

  it('cloned ticket type preserves max_per_user limit', () => {
    const original = makeTicketType({ max_per_user: 8 })
    const result = sanitizeClonedTicketType(original)
    expect(result.max_per_user).toBe(8)
  })

  it('cloned ticket type preserves zone assignment', () => {
    const original = makeTicketType({ zone_id: 'zone-vip-platinum' })
    const result = sanitizeClonedTicketType(original)
    expect(result.zone_id).toBe('zone-vip-platinum')
  })

  it('cloned ticket type preserves kind (seated/standing)', () => {
    const seated = makeTicketType({ kind: 'seated' })
    const standing = makeTicketType({ kind: 'standing' })
    expect(sanitizeClonedTicketType(seated).kind).toBe('seated')
    expect(sanitizeClonedTicketType(standing).kind).toBe('standing')
  })
})

describe('validateCloneOptions — clone with new date edge cases', () => {
  it('rejects when newDateStart is in the past', () => {
    const errors = validateCloneOptions(
      makeOptions({ newDateStart: past(10 * DAY), newDateEnd: future(1 * DAY) }),
      NOW
    )
    expect(errors.some(e => e.includes('newDateStart'))).toBe(true)
  })

  it('rejects when newDateStart equals NOW (not strictly future)', () => {
    const errors = validateCloneOptions(
      makeOptions({ newDateStart: NOW, newDateEnd: future(1 * DAY) }),
      NOW
    )
    expect(errors.some(e => e.includes('newDateStart'))).toBe(true)
  })

  it('rejects when newDateEnd is before newDateStart', () => {
    const errors = validateCloneOptions(
      makeOptions({
        newDateStart: future(5 * DAY),
        newDateEnd: future(2 * DAY),
      }),
      NOW
    )
    expect(errors.some(e => e.includes('newDateEnd'))).toBe(true)
  })

  it('allows on_sale_at == newDateStart - 1ms (edge case)', () => {
    const start = future(10 * DAY)
    const errors = validateCloneOptions(
      makeOptions({
        newDateStart: start,
        newDateEnd: future(11 * DAY),
        onSaleAt: new Date(start.getTime() - 1),
      }),
      NOW
    )
    expect(errors.filter(e => e.includes('onSaleAt'))).toHaveLength(0)
  })

  it('accumulates errors for multiple validation failures', () => {
    const errors = validateCloneOptions(
      makeOptions({
        newDateStart: past(5 * DAY),
        newDateEnd: past(10 * DAY),
        newTitle: '   ',
        onSaleAt: future(20 * DAY),
        offSaleAt: future(10 * DAY),
      }),
      NOW
    )
    expect(errors.length).toBeGreaterThanOrEqual(3)
  })

  it('validates pricing rules dependency correctly', () => {
    // clonePricingRules=true but cloneTicketTypes=false is invalid
    const errors = validateCloneOptions(
      makeOptions({ cloneTicketTypes: false, clonePricingRules: true }),
      NOW
    )
    expect(errors.some(e => e.includes('clonePricingRules'))).toBe(true)
  })
})
