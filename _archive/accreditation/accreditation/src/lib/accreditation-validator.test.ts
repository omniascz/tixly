// ---------------------------------------------------------------------------
// Accreditation Validator — Vitest unit tests
// ---------------------------------------------------------------------------

import { describe, it, expect } from 'vitest';
import {
  getBadgeColor,
  generateAccreditationQr,
  isValidForDay,
  canScanAccreditation,
  validateAccreditationRequest,
} from './accreditation-validator';
import type { Accreditation, AccreditationType } from '../types/accreditation.types';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeAccreditation(overrides: Partial<Accreditation> = {}): Accreditation {
  return {
    id: '550e8400-e29b-41d4-a716-446655440000',
    event_id: 'event-1',
    holder_name: 'Jan Novák',
    holder_email: 'jan.novak@example.com',
    holder_phone: null,
    holder_organization: null,
    accreditation_type: 'press',
    role_description: 'Fotograf',
    zone_access: ['zone-press', 'zone-main'],
    valid_days: null,
    status: 'active',
    qr_code: 'ACC-550E8400E29B',
    badge_color: '#3b82f6',
    photo_url: null,
    requested_by_user_id: 'user-1',
    approved_by_user_id: 'organizer-1',
    issued_at: new Date('2026-08-01T10:00:00Z'),
    approved_at: new Date('2026-07-30T10:00:00Z'),
    rejected_at: null,
    revoked_at: null,
    revocation_reason: null,
    notes: null,
    created_at: new Date('2026-07-28T08:00:00Z'),
    ...overrides,
  };
}

const NOW = new Date('2026-08-15T14:00:00Z');

// ---------------------------------------------------------------------------
// getBadgeColor
// ---------------------------------------------------------------------------

describe('getBadgeColor', () => {
  it('returns yellow for staff', () => {
    expect(getBadgeColor('staff')).toBe('#f59e0b');
  });

  it('returns blue for press', () => {
    expect(getBadgeColor('press')).toBe('#3b82f6');
  });

  it('returns red for artist', () => {
    expect(getBadgeColor('artist')).toBe('#ef4444');
  });

  it('returns purple for vip_host', () => {
    expect(getBadgeColor('vip_host')).toBe('#8b5cf6');
  });

  it('returns green for volunteer', () => {
    expect(getBadgeColor('volunteer')).toBe('#10b981');
  });

  it('returns orange for vendor', () => {
    expect(getBadgeColor('vendor')).toBe('#f97316');
  });

  it('returns dark blue for organizer', () => {
    expect(getBadgeColor('organizer')).toBe('#1a56db');
  });

  it('returns a valid hex color for all types', () => {
    const types: AccreditationType[] = [
      'staff', 'press', 'artist', 'vip_host', 'volunteer', 'vendor', 'organizer',
    ];
    const hexRegex = /^#[0-9a-f]{6}$/i;
    for (const type of types) {
      expect(getBadgeColor(type)).toMatch(hexRegex);
    }
  });
});

// ---------------------------------------------------------------------------
// generateAccreditationQr
// ---------------------------------------------------------------------------

describe('generateAccreditationQr', () => {
  it('starts with ACC-', () => {
    const qr = generateAccreditationQr('550e8400-e29b-41d4-a716-446655440000');
    expect(qr).toMatch(/^ACC-/);
  });

  it('produces exactly 16 characters total (ACC- + 12)', () => {
    const qr = generateAccreditationQr('550e8400-e29b-41d4-a716-446655440000');
    expect(qr.length).toBe(16);
  });

  it('uppercases the ID and removes dashes', () => {
    const qr = generateAccreditationQr('550e8400-e29b-41d4-a716-446655440000');
    expect(qr).toBe('ACC-550E8400E29B');
  });

  it('is deterministic — same input gives same output', () => {
    const id = 'aaaabbbb-cccc-dddd-eeee-ffffffffffff';
    expect(generateAccreditationQr(id)).toBe(generateAccreditationQr(id));
  });

  it('handles short IDs without dashes', () => {
    const qr = generateAccreditationQr('abc123');
    expect(qr).toBe('ACC-ABC123');
  });

  it('truncates long IDs to 12 characters after the prefix', () => {
    const qr = generateAccreditationQr('aabbccdd-eeff-0011-2233-445566778899');
    const suffix = qr.slice(4);
    expect(suffix.length).toBe(12);
  });
});

// ---------------------------------------------------------------------------
// isValidForDay
// ---------------------------------------------------------------------------

describe('isValidForDay', () => {
  it('returns true when valid_days is null (entire event)', () => {
    const acc = makeAccreditation({ valid_days: null });
    expect(isValidForDay(acc, NOW)).toBe(true);
  });

  it('returns true when date matches one of the valid_days', () => {
    const acc = makeAccreditation({ valid_days: ['2026-08-15', '2026-08-16'] });
    expect(isValidForDay(acc, new Date('2026-08-15T20:00:00Z'))).toBe(true);
  });

  it('returns false when date does not match any valid_day', () => {
    const acc = makeAccreditation({ valid_days: ['2026-08-16', '2026-08-17'] });
    expect(isValidForDay(acc, new Date('2026-08-15T20:00:00Z'))).toBe(false);
  });

  it('returns false when valid_days is an empty array', () => {
    const acc = makeAccreditation({ valid_days: [] });
    expect(isValidForDay(acc, NOW)).toBe(false);
  });

  it('matches by ISO date string (YYYY-MM-DD) regardless of time', () => {
    const acc = makeAccreditation({ valid_days: ['2026-08-15'] });
    expect(isValidForDay(acc, new Date('2026-08-15T00:00:00Z'))).toBe(true);
    expect(isValidForDay(acc, new Date('2026-08-15T23:59:59Z'))).toBe(true);
  });

  it('returns false for previous day', () => {
    const acc = makeAccreditation({ valid_days: ['2026-08-16'] });
    expect(isValidForDay(acc, new Date('2026-08-15T22:00:00Z'))).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// canScanAccreditation
// ---------------------------------------------------------------------------

describe('canScanAccreditation', () => {
  it('returns allowed true for an active accreditation with zone access', () => {
    const acc = makeAccreditation({ status: 'active', zone_access: ['zone-press'] });
    const result = canScanAccreditation(acc, ['zone-press'], NOW);
    expect(result.allowed).toBe(true);
    expect(result.reason).toBeUndefined();
  });

  it('returns allowed true for issued status (auto-activation flow)', () => {
    const acc = makeAccreditation({ status: 'issued', zone_access: ['zone-main'] });
    const result = canScanAccreditation(acc, ['zone-main'], NOW);
    expect(result.allowed).toBe(true);
  });

  it('denies accreditation with requested status', () => {
    const acc = makeAccreditation({ status: 'requested' });
    const result = canScanAccreditation(acc, ['zone-main'], NOW);
    expect(result.allowed).toBe(false);
    expect(result.reason).toBeTruthy();
  });

  it('denies accreditation with approved status', () => {
    const acc = makeAccreditation({ status: 'approved' });
    const result = canScanAccreditation(acc, ['zone-main'], NOW);
    expect(result.allowed).toBe(false);
  });

  it('denies revoked accreditation with specific message', () => {
    const acc = makeAccreditation({ status: 'revoked' });
    const result = canScanAccreditation(acc, ['zone-main'], NOW);
    expect(result.allowed).toBe(false);
    expect(result.reason).toContain('odebrána');
  });

  it('denies when zone not in zone_access', () => {
    const acc = makeAccreditation({ status: 'active', zone_access: ['zone-press'] });
    const result = canScanAccreditation(acc, ['zone-backstage'], NOW);
    expect(result.allowed).toBe(false);
    expect(result.reason).toBeTruthy();
  });

  it('allows when at least one of multiple requested zones matches', () => {
    const acc = makeAccreditation({ status: 'active', zone_access: ['zone-press', 'zone-main'] });
    const result = canScanAccreditation(acc, ['zone-backstage', 'zone-main'], NOW);
    expect(result.allowed).toBe(true);
  });

  it('denies when valid_days does not include today', () => {
    const acc = makeAccreditation({
      status: 'active',
      zone_access: ['zone-press'],
      valid_days: ['2026-08-16', '2026-08-17'],
    });
    const result = canScanAccreditation(acc, ['zone-press'], NOW); // NOW = 2026-08-15
    expect(result.allowed).toBe(false);
    expect(result.reason).toContain('2026-08-15');
  });

  it('allows when valid_days includes today', () => {
    const acc = makeAccreditation({
      status: 'active',
      zone_access: ['zone-press'],
      valid_days: ['2026-08-15', '2026-08-16'],
    });
    const result = canScanAccreditation(acc, ['zone-press'], NOW);
    expect(result.allowed).toBe(true);
  });

  it('denies when zone list is empty', () => {
    const acc = makeAccreditation({ status: 'active', zone_access: ['zone-press'] });
    const result = canScanAccreditation(acc, [], NOW);
    expect(result.allowed).toBe(false);
  });

  it('denies rejected accreditation', () => {
    const acc = makeAccreditation({ status: 'rejected' });
    const result = canScanAccreditation(acc, ['zone-press'], NOW);
    expect(result.allowed).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// validateAccreditationRequest
// ---------------------------------------------------------------------------

describe('validateAccreditationRequest', () => {
  function validData() {
    return {
      holderName: 'Jan Novák',
      holderEmail: 'jan@example.com',
      accreditationType: 'press' as AccreditationType,
      zoneAccess: ['zone-press'],
    };
  }

  it('does not throw for valid input', () => {
    expect(() => validateAccreditationRequest(validData())).not.toThrow();
  });

  it('throws when holderName is empty string', () => {
    expect(() =>
      validateAccreditationRequest({ ...validData(), holderName: '' })
    ).toThrow('holderName');
  });

  it('throws when holderName is whitespace only', () => {
    expect(() =>
      validateAccreditationRequest({ ...validData(), holderName: '   ' })
    ).toThrow('holderName');
  });

  it('throws when holderEmail is empty', () => {
    expect(() =>
      validateAccreditationRequest({ ...validData(), holderEmail: '' })
    ).toThrow('holderEmail');
  });

  it('throws when holderEmail is missing @', () => {
    expect(() =>
      validateAccreditationRequest({ ...validData(), holderEmail: 'notanemail' })
    ).toThrow('holderEmail');
  });

  it('throws when holderEmail has no domain', () => {
    expect(() =>
      validateAccreditationRequest({ ...validData(), holderEmail: 'user@' })
    ).toThrow('holderEmail');
  });

  it('throws when zoneAccess is empty array', () => {
    expect(() =>
      validateAccreditationRequest({ ...validData(), zoneAccess: [] })
    ).toThrow('zoneAccess');
  });

  it('accepts multiple zones', () => {
    expect(() =>
      validateAccreditationRequest({ ...validData(), zoneAccess: ['zone-a', 'zone-b'] })
    ).not.toThrow();
  });
});
