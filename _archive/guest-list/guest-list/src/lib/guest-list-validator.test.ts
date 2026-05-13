import { describe, it, expect } from 'vitest';
import {
  validateGuestEntry,
  canCheckIn,
  normalizeGuestName,
  normalizeEmail,
  formatCheckInConfirmation,
  searchGuests,
} from './guest-list-validator';
import type { GuestEntry } from '../types/guest-list.types';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeGuest(overrides: Partial<GuestEntry> = {}): GuestEntry {
  return {
    id: 'g1',
    event_id: 'e1',
    name: 'Jan Novák',
    email: 'jan@example.com',
    phone: null,
    guest_type: 'vip',
    status: 'invited',
    plus_count: 0,
    total_count: 1,
    zone_access: [],
    notes: null,
    added_by_user_id: 'u1',
    confirmed_at: null,
    checked_in_at: null,
    checked_in_by_staff_id: null,
    created_at: new Date('2026-04-04T10:00:00Z'),
    updated_at: new Date('2026-04-04T10:00:00Z'),
    ...overrides,
  };
}

const now = new Date('2026-04-04T20:00:00Z');

// ---------------------------------------------------------------------------
// validateGuestEntry
// ---------------------------------------------------------------------------

describe('validateGuestEntry', () => {
  it('passes for valid data with email', () => {
    expect(() =>
      validateGuestEntry({ name: 'Jan Novák', email: 'jan@example.com', plusCount: 2 }),
    ).not.toThrow();
  });

  it('passes when email is omitted', () => {
    expect(() => validateGuestEntry({ name: 'Jan Novák', plusCount: 0 })).not.toThrow();
  });

  it('throws for empty name', () => {
    expect(() => validateGuestEntry({ name: '', plusCount: 0 })).toThrow('must not be empty');
  });

  it('throws for whitespace-only name', () => {
    expect(() => validateGuestEntry({ name: '   ', plusCount: 0 })).toThrow('must not be empty');
  });

  it('throws when plusCount is negative', () => {
    expect(() => validateGuestEntry({ name: 'Jan', plusCount: -1 })).toThrow('between 0 and 9');
  });

  it('throws when plusCount exceeds 9', () => {
    expect(() => validateGuestEntry({ name: 'Jan', plusCount: 10 })).toThrow('between 0 and 9');
  });

  it('throws for non-integer plusCount', () => {
    expect(() => validateGuestEntry({ name: 'Jan', plusCount: 1.5 })).toThrow('between 0 and 9');
  });

  it('throws for invalid email format', () => {
    expect(() =>
      validateGuestEntry({ name: 'Jan', email: 'not-an-email', plusCount: 0 }),
    ).toThrow('Invalid email');
  });

  it('passes for empty-string email (treated as no email)', () => {
    // Empty string should not trigger email validation
    expect(() => validateGuestEntry({ name: 'Jan', email: '', plusCount: 0 })).not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// canCheckIn
// ---------------------------------------------------------------------------

describe('canCheckIn', () => {
  it('allows check-in for invited guest', () => {
    expect(canCheckIn(makeGuest({ status: 'invited' }), now)).toEqual({ allowed: true });
  });

  it('allows check-in for confirmed guest', () => {
    expect(canCheckIn(makeGuest({ status: 'confirmed' }), now)).toEqual({ allowed: true });
  });

  it('denies check-in for already checked-in guest', () => {
    const result = canCheckIn(makeGuest({ status: 'checked_in' }), now);
    expect(result.allowed).toBe(false);
    expect(result.reason).toMatch(/already checked in/i);
  });

  it('denies check-in for cancelled guest', () => {
    const result = canCheckIn(makeGuest({ status: 'cancelled' }), now);
    expect(result.allowed).toBe(false);
    expect(result.reason).toMatch(/cancelled/i);
  });

  it('denies check-in for no_show guest', () => {
    const result = canCheckIn(makeGuest({ status: 'no_show' }), now);
    expect(result.allowed).toBe(false);
    expect(result.reason).toMatch(/no-show/i);
  });
});

// ---------------------------------------------------------------------------
// normalizeGuestName
// ---------------------------------------------------------------------------

describe('normalizeGuestName', () => {
  it('trims leading and trailing whitespace', () => {
    expect(normalizeGuestName('  Jan Novák  ')).toBe('Jan Novák');
  });

  it('collapses multiple internal spaces', () => {
    expect(normalizeGuestName('jan  novák')).toBe('Jan Novák');
  });

  it('title-cases each word', () => {
    expect(normalizeGuestName('jan novák')).toBe('Jan Novák');
  });

  it('preserves diacritics', () => {
    expect(normalizeGuestName('jiří dvořák')).toBe('Jiří Dvořák');
  });

  it('handles single word', () => {
    expect(normalizeGuestName('madonna')).toBe('Madonna');
  });

  it('handles already-correct casing', () => {
    expect(normalizeGuestName('Jan Novák')).toBe('Jan Novák');
  });
});

// ---------------------------------------------------------------------------
// normalizeEmail
// ---------------------------------------------------------------------------

describe('normalizeEmail', () => {
  it('converts to lowercase', () => {
    expect(normalizeEmail('JAN@EXAMPLE.COM')).toBe('jan@example.com');
  });

  it('trims surrounding whitespace', () => {
    expect(normalizeEmail('  jan@example.com  ')).toBe('jan@example.com');
  });

  it('lowercases mixed case', () => {
    expect(normalizeEmail('Jan.Novak@Example.Com')).toBe('jan.novak@example.com');
  });
});

// ---------------------------------------------------------------------------
// formatCheckInConfirmation
// ---------------------------------------------------------------------------

describe('formatCheckInConfirmation', () => {
  const checkedInAt = new Date('2026-04-04T15:42:00');

  it('formats CS with plus_count > 0', () => {
    const guest = makeGuest({ plus_count: 2, guest_type: 'vip', checked_in_at: checkedInAt });
    const result = formatCheckInConfirmation(guest, 'cs');
    expect(result).toMatch(/Jan Novák \+2 \(VIP\) — Odbaven/);
    expect(result).toMatch(/15:42/);
  });

  it('formats EN with plus_count > 0', () => {
    const guest = makeGuest({ plus_count: 2, guest_type: 'vip', checked_in_at: checkedInAt });
    const result = formatCheckInConfirmation(guest, 'en');
    expect(result).toMatch(/Jan Novák \+2 \(VIP\) — Checked in/);
    expect(result).toMatch(/15:42/);
  });

  it('omits plus part when plus_count is 0', () => {
    const guest = makeGuest({ plus_count: 0, guest_type: 'press', checked_in_at: checkedInAt });
    const result = formatCheckInConfirmation(guest, 'cs');
    expect(result).not.toMatch(/\+/);
    expect(result).toMatch(/Tisk/);
  });

  it('formats EN with plus_count 1', () => {
    const guest = makeGuest({ plus_count: 1, guest_type: 'industry', checked_in_at: checkedInAt });
    const result = formatCheckInConfirmation(guest, 'en');
    expect(result).toMatch(/\+1/);
    expect(result).toMatch(/Industry/);
  });

  it('formats EN with plus_count 5', () => {
    const guest = makeGuest({ plus_count: 5, guest_type: 'promo', checked_in_at: checkedInAt });
    const result = formatCheckInConfirmation(guest, 'en');
    expect(result).toMatch(/\+5/);
    expect(result).toMatch(/Promo/);
  });

  it('uses correct CS label for press', () => {
    const guest = makeGuest({ guest_type: 'press', checked_in_at: checkedInAt });
    expect(formatCheckInConfirmation(guest, 'cs')).toMatch(/Tisk/);
  });

  it('uses correct CS label for other', () => {
    const guest = makeGuest({ guest_type: 'other', checked_in_at: checkedInAt });
    expect(formatCheckInConfirmation(guest, 'cs')).toMatch(/Ostatní/);
  });
});

// ---------------------------------------------------------------------------
// searchGuests
// ---------------------------------------------------------------------------

describe('searchGuests', () => {
  const guests: GuestEntry[] = [
    makeGuest({ id: 'g1', name: 'Jan Novák', email: 'jan@example.com' }),
    makeGuest({ id: 'g2', name: 'Petra Dvořák', email: 'petra@example.com' }),
    makeGuest({ id: 'g3', name: 'Jiří Černý', email: 'jiri@media.cz' }),
    makeGuest({ id: 'g4', name: 'Anna Horáková', email: null }),
  ];

  it('returns all guests for empty query', () => {
    expect(searchGuests(guests, '')).toHaveLength(4);
  });

  it('finds guest by exact name match', () => {
    const result = searchGuests(guests, 'Jan Novák');
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe('g1');
  });

  it('finds guest by partial name match', () => {
    const result = searchGuests(guests, 'novák');
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe('g1');
  });

  it('is case-insensitive', () => {
    const result = searchGuests(guests, 'PETRA');
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe('g2');
  });

  it('is diacritic-insensitive', () => {
    const result = searchGuests(guests, 'dvorak');
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe('g2');
  });

  it('finds guest by email', () => {
    const result = searchGuests(guests, 'media.cz');
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe('g3');
  });

  it('returns empty array when no match', () => {
    expect(searchGuests(guests, 'xyznobodyhere')).toHaveLength(0);
  });

  it('handles guest with null email without throwing', () => {
    const result = searchGuests(guests, 'anna');
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe('g4');
  });
});
