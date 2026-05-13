import { describe, it, expect } from 'vitest'
import {
  canPickUp,
  isWithinPickupWindow,
  shouldForfeiture,
  formatPickupConfirmation,
  normalizeSearchQuery,
} from './will-call-validator'
import type { WillCallEntry } from '../types/will-call.types'

function makeEntry(overrides: Partial<WillCallEntry> = {}): WillCallEntry {
  return {
    id: 'entry-1',
    ticket_id: 'ticket-1',
    order_id: 'order-1',
    event_id: 'event-1',
    holder_name: 'Jan Novák',
    holder_email: 'jan@example.com',
    holder_phone: null,
    ticket_type_name: 'Standard',
    quantity: 2,
    status: 'ready_for_pickup',
    pickup_location: null,
    pickup_window_start: null,
    pickup_window_end: null,
    notes: null,
    picked_up_at: null,
    picked_up_by_staff_id: null,
    forfeited_at: null,
    created_at: new Date('2026-04-04T10:00:00Z'),
    ...overrides,
  }
}

const NOW = new Date('2026-04-04T15:00:00Z')
const BEFORE = new Date('2026-04-04T14:00:00Z')
const AFTER = new Date('2026-04-04T16:00:00Z')

// ── canPickUp ────────────────────────────────────────────────────────────────

describe('canPickUp', () => {
  it('allows pickup when status is ready_for_pickup and no window set', () => {
    const entry = makeEntry({ status: 'ready_for_pickup' })
    expect(canPickUp(entry, NOW)).toEqual({ allowed: true })
  })

  it('allows pickup when status is reserved and no window set', () => {
    const entry = makeEntry({ status: 'reserved' })
    expect(canPickUp(entry, NOW)).toEqual({ allowed: true })
  })

  it('denies pickup when status is picked_up', () => {
    const entry = makeEntry({ status: 'picked_up' })
    const result = canPickUp(entry, NOW)
    expect(result.allowed).toBe(false)
    expect(result.reason).toBe('already_picked_up')
  })

  it('denies pickup when status is forfeited', () => {
    const entry = makeEntry({ status: 'forfeited' })
    const result = canPickUp(entry, NOW)
    expect(result.allowed).toBe(false)
    expect(result.reason).toBe('forfeited')
  })

  it('allows pickup when now is within pickup window', () => {
    const entry = makeEntry({
      pickup_window_start: BEFORE,
      pickup_window_end: AFTER,
    })
    expect(canPickUp(entry, NOW)).toEqual({ allowed: true })
  })

  it('denies pickup when now is before pickup_window_start', () => {
    const entry = makeEntry({
      pickup_window_start: AFTER,
      pickup_window_end: new Date('2026-04-04T18:00:00Z'),
    })
    const result = canPickUp(entry, NOW)
    expect(result.allowed).toBe(false)
    expect(result.reason).toBe('window_closed')
  })

  it('denies pickup when now is after pickup_window_end', () => {
    const entry = makeEntry({
      pickup_window_start: new Date('2026-04-04T12:00:00Z'),
      pickup_window_end: BEFORE,
    })
    const result = canPickUp(entry, NOW)
    expect(result.allowed).toBe(false)
    expect(result.reason).toBe('window_closed')
  })

  it('allows pickup with only pickup_window_start set and now is after it', () => {
    const entry = makeEntry({ pickup_window_start: BEFORE, pickup_window_end: null })
    expect(canPickUp(entry, NOW)).toEqual({ allowed: true })
  })

  it('allows pickup with only pickup_window_end set and now is before it', () => {
    const entry = makeEntry({ pickup_window_start: null, pickup_window_end: AFTER })
    expect(canPickUp(entry, NOW)).toEqual({ allowed: true })
  })
})

// ── isWithinPickupWindow ─────────────────────────────────────────────────────

describe('isWithinPickupWindow', () => {
  it('returns true when no window is configured', () => {
    const entry = makeEntry()
    expect(isWithinPickupWindow(entry, NOW)).toBe(true)
  })

  it('returns true when now is exactly at window start', () => {
    const entry = makeEntry({ pickup_window_start: NOW, pickup_window_end: AFTER })
    expect(isWithinPickupWindow(entry, NOW)).toBe(true)
  })

  it('returns false when now is exactly at window end boundary (past)', () => {
    const entry = makeEntry({
      pickup_window_start: BEFORE,
      pickup_window_end: new Date(NOW.getTime() - 1),
    })
    expect(isWithinPickupWindow(entry, NOW)).toBe(false)
  })
})

// ── shouldForfeiture ─────────────────────────────────────────────────────────

describe('shouldForfeiture', () => {
  it('returns true when window has expired and status is ready_for_pickup', () => {
    const entry = makeEntry({
      status: 'ready_for_pickup',
      pickup_window_end: BEFORE,
    })
    expect(shouldForfeiture(entry, NOW)).toBe(true)
  })

  it('returns false when window is still active', () => {
    const entry = makeEntry({
      status: 'ready_for_pickup',
      pickup_window_end: AFTER,
    })
    expect(shouldForfeiture(entry, NOW)).toBe(false)
  })

  it('returns false when no pickup_window_end is set', () => {
    const entry = makeEntry({ status: 'ready_for_pickup', pickup_window_end: null })
    expect(shouldForfeiture(entry, NOW)).toBe(false)
  })

  it('returns false when status is not ready_for_pickup even if window expired', () => {
    const entry = makeEntry({ status: 'reserved', pickup_window_end: BEFORE })
    expect(shouldForfeiture(entry, NOW)).toBe(false)
  })

  it('returns false when status is picked_up', () => {
    const entry = makeEntry({ status: 'picked_up', pickup_window_end: BEFORE })
    expect(shouldForfeiture(entry, NOW)).toBe(false)
  })
})

// ── formatPickupConfirmation ─────────────────────────────────────────────────

describe('formatPickupConfirmation', () => {
  const pickedUpAt = new Date('2026-04-04T15:42:00Z')

  it('formats cs singular (1 ticket)', () => {
    const entry = makeEntry({ quantity: 1, picked_up_at: pickedUpAt, ticket_type_name: 'Standard' })
    const result = formatPickupConfirmation(entry, 'cs')
    expect(result).toContain('Jan Novák')
    expect(result).toContain('1× vstupenka')
    expect(result).toContain('Standard')
    expect(result).toMatch(/\d{2}:\d{2}/)
  })

  it('formats cs few (2–4 tickets)', () => {
    const entry = makeEntry({ quantity: 3, picked_up_at: pickedUpAt, ticket_type_name: 'VIP' })
    const result = formatPickupConfirmation(entry, 'cs')
    expect(result).toContain('3× vstupenky')
  })

  it('formats cs many (5+ tickets)', () => {
    const entry = makeEntry({ quantity: 5, picked_up_at: pickedUpAt, ticket_type_name: 'Standard' })
    const result = formatPickupConfirmation(entry, 'cs')
    expect(result).toContain('5× vstupenek')
  })

  it('formats en singular (1 ticket)', () => {
    const entry = makeEntry({ quantity: 1, picked_up_at: pickedUpAt, ticket_type_name: 'GA' })
    const result = formatPickupConfirmation(entry, 'en')
    expect(result).toContain('1 ticket')
    expect(result).toContain('GA')
    expect(result).toContain('Jan Novák')
  })

  it('formats en plural (2+ tickets)', () => {
    const entry = makeEntry({ quantity: 4, picked_up_at: pickedUpAt, ticket_type_name: 'GA' })
    const result = formatPickupConfirmation(entry, 'en')
    expect(result).toContain('4 tickets')
  })

  it('includes prefix "Vstupenka vydána:" for cs', () => {
    const entry = makeEntry({ quantity: 2, picked_up_at: pickedUpAt })
    expect(formatPickupConfirmation(entry, 'cs')).toMatch(/^Vstupenka vydána:/)
  })

  it('includes prefix "Ticket issued:" for en', () => {
    const entry = makeEntry({ quantity: 2, picked_up_at: pickedUpAt })
    expect(formatPickupConfirmation(entry, 'en')).toMatch(/^Ticket issued:/)
  })
})

// ── normalizeSearchQuery ─────────────────────────────────────────────────────

describe('normalizeSearchQuery', () => {
  it('lowercases the query', () => {
    expect(normalizeSearchQuery('NOVAK')).toBe('novak')
  })

  it('trims leading and trailing whitespace', () => {
    expect(normalizeSearchQuery('  novak  ')).toBe('novak')
  })

  it('removes Czech diacritics', () => {
    expect(normalizeSearchQuery('Novák')).toBe('novak')
    expect(normalizeSearchQuery('Šťastný')).toBe('stastny')
    expect(normalizeSearchQuery('Čeněk Říha')).toBe('cenek riha')
  })

  it('handles mixed case with diacritics', () => {
    expect(normalizeSearchQuery('ŘeŘicha')).toBe('rericha')
  })

  it('handles string with no diacritics unchanged (after lower/trim)', () => {
    expect(normalizeSearchQuery('  hello world  ')).toBe('hello world')
  })
})
