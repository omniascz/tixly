// ---------------------------------------------------------------------------
// Guest List — pure validation & formatting helpers
// ---------------------------------------------------------------------------

import type { GuestEntry, GuestType } from '../types/guest-list.types.js';

// ---------------------------------------------------------------------------
// validateGuestEntry
// ---------------------------------------------------------------------------

/**
 * Throws a descriptive Error if any field is invalid.
 * Call before persisting a new guest entry.
 */
export function validateGuestEntry(data: {
  name: string;
  email?: string;
  plusCount: number;
}): void {
  if (!data.name || data.name.trim().length === 0) {
    throw new Error('Guest name must not be empty.');
  }

  if (!Number.isInteger(data.plusCount) || data.plusCount < 0 || data.plusCount > 9) {
    throw new Error('plus_count must be an integer between 0 and 9.');
  }

  if (data.email !== undefined && data.email.trim().length > 0) {
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(data.email.trim())) {
      throw new Error(`Invalid email address: "${data.email}".`);
    }
  }
}

// ---------------------------------------------------------------------------
// canCheckIn
// ---------------------------------------------------------------------------

export interface CanCheckInResult {
  allowed: boolean;
  reason?: string;
}

/**
 * Returns whether a guest may be checked in right now.
 * The `now` parameter is injected for testability.
 */
export function canCheckIn(guest: GuestEntry, _now: Date): CanCheckInResult {
  switch (guest.status) {
    case 'invited':
    case 'confirmed':
      return { allowed: true };

    case 'checked_in':
      return { allowed: false, reason: 'Guest is already checked in.' };

    case 'cancelled':
      return { allowed: false, reason: 'Guest entry has been cancelled.' };

    case 'no_show':
      return { allowed: false, reason: 'Guest was marked as a no-show.' };

    default: {
      const _exhaustive: never = guest.status;
      return { allowed: false, reason: `Unknown status: ${_exhaustive}` };
    }
  }
}

// ---------------------------------------------------------------------------
// normalizeGuestName
// ---------------------------------------------------------------------------

/**
 * Trims, collapses internal whitespace, and title-cases each word.
 * Diacritics are preserved ("Dvořák" stays "Dvořák").
 *
 * Example: "jan  novák" → "Jan Novák"
 */
export function normalizeGuestName(name: string): string {
  return name
    .trim()
    .replace(/\s+/g, ' ')
    .replace(/\S+/g, (word) => word.charAt(0).toUpperCase() + word.slice(1));
}

// ---------------------------------------------------------------------------
// normalizeEmail
// ---------------------------------------------------------------------------

/** Trims and lower-cases an email address. */
export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

// ---------------------------------------------------------------------------
// formatCheckInConfirmation
// ---------------------------------------------------------------------------

const GUEST_TYPE_LABELS: Record<GuestType, { cs: string; en: string }> = {
  complimentary: { cs: 'Complimentary', en: 'Complimentary' },
  press:         { cs: 'Tisk',          en: 'Press' },
  vip:           { cs: 'VIP',           en: 'VIP' },
  industry:      { cs: 'Industry',      en: 'Industry' },
  promo:         { cs: 'Promo',         en: 'Promo' },
  other:         { cs: 'Ostatní',       en: 'Other' },
};

/**
 * Returns a single-line check-in confirmation string.
 *
 * CS: "Jan Novák +2 (VIP) — Odbaven 15:42"
 * EN: "Jan Novák +2 (VIP) — Checked in 15:42"
 */
export function formatCheckInConfirmation(guest: GuestEntry, lang: 'cs' | 'en'): string {
  const typeLabel = GUEST_TYPE_LABELS[guest.guest_type][lang];
  const checkedInAt = guest.checked_in_at ?? new Date();
  const time = checkedInAt.toLocaleTimeString(lang === 'cs' ? 'cs-CZ' : 'en-GB', {
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });

  const plusPart = guest.plus_count > 0 ? ` +${guest.plus_count}` : '';
  const action = lang === 'cs' ? 'Odbaven' : 'Checked in';

  return `${guest.name}${plusPart} (${typeLabel}) — ${action} ${time}`;
}

// ---------------------------------------------------------------------------
// searchGuests
// ---------------------------------------------------------------------------

/**
 * Filters a guest list by a free-text query.
 * Matches against name and email, case- and diacritic-insensitive.
 */
export function searchGuests(guests: GuestEntry[], query: string): GuestEntry[] {
  if (!query || query.trim().length === 0) return guests;

  const normalize = (s: string): string =>
    s
      .trim()
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '');

  const q = normalize(query);

  return guests.filter((g) => {
    const nameMatch = normalize(g.name).includes(q);
    const emailMatch = g.email ? normalize(g.email).includes(q) : false;
    return nameMatch || emailMatch;
  });
}
