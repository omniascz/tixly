// ---------------------------------------------------------------------------
// Accreditation Validator — pure functions, no DB dependency
// ---------------------------------------------------------------------------

import type { Accreditation, AccreditationType } from '../types/accreditation.types';

// ---------------------------------------------------------------------------
// getBadgeColor
// Returns the hex color associated with each accreditation type.
// ---------------------------------------------------------------------------
export function getBadgeColor(type: AccreditationType): string {
  const colors: Record<AccreditationType, string> = {
    staff: '#f59e0b',
    press: '#3b82f6',
    artist: '#ef4444',
    vip_host: '#8b5cf6',
    volunteer: '#10b981',
    vendor: '#f97316',
    organizer: '#1a56db',
  };
  return colors[type];
}

// ---------------------------------------------------------------------------
// generateAccreditationQr
// Generates a static, deterministic QR code string from the accreditation ID.
// Format: ACC-<first 12 chars of uppercased ID without dashes>
// ---------------------------------------------------------------------------
export function generateAccreditationQr(accreditationId: string): string {
  const sanitized = accreditationId.toUpperCase().replace(/-/g, '').slice(0, 12);
  return `ACC-${sanitized}`;
}

// ---------------------------------------------------------------------------
// isValidForDay
// Returns true when the accreditation is valid on the given date.
// If valid_days is null, the accreditation is valid for the entire event.
// ---------------------------------------------------------------------------
export function isValidForDay(accreditation: Accreditation, date: Date): boolean {
  if (accreditation.valid_days === null) {
    return true;
  }
  const iso = date.toISOString().slice(0, 10); // "YYYY-MM-DD"
  return accreditation.valid_days.includes(iso);
}

// ---------------------------------------------------------------------------
// canScanAccreditation
// Validates whether an accreditation can be scanned at a given moment for
// the specified zones. Returns { allowed, reason? }.
// ---------------------------------------------------------------------------
export function canScanAccreditation(
  accreditation: Accreditation,
  zoneIds: string[],
  now: Date
): { allowed: boolean; reason?: string } {
  // 1. Status must be 'active' or 'issued'
  if (
    accreditation.status !== 'active' &&
    accreditation.status !== 'issued'
  ) {
    if (accreditation.status === 'revoked') {
      return { allowed: false, reason: 'Akreditace byla odebrána.' };
    }
    return {
      allowed: false,
      reason: `Akreditace není aktivní (stav: ${accreditation.status}).`,
    };
  }

  // 2. Valid day check
  if (!isValidForDay(accreditation, now)) {
    const iso = now.toISOString().slice(0, 10);
    return {
      allowed: false,
      reason: `Akreditace není platná pro dnešní den (${iso}).`,
    };
  }

  // 3. Zone access check — at least one requested zone must be in zone_access
  if (zoneIds.length === 0) {
    return { allowed: false, reason: 'Nebyly zadány žádné zóny.' };
  }
  const accessSet = new Set(accreditation.zone_access);
  const hasZoneAccess = zoneIds.some((id) => accessSet.has(id));
  if (!hasZoneAccess) {
    return {
      allowed: false,
      reason: 'Akreditace neopravňuje ke vstupu do požadované zóny.',
    };
  }

  return { allowed: true };
}

// ---------------------------------------------------------------------------
// validateAccreditationRequest
// Throws a plain Error with a descriptive message when input is invalid.
// ---------------------------------------------------------------------------
export function validateAccreditationRequest(data: {
  holderName: string;
  holderEmail: string;
  accreditationType: AccreditationType;
  zoneAccess: string[];
}): void {
  if (!data.holderName || data.holderName.trim().length === 0) {
    throw new Error('holderName must not be empty.');
  }

  if (!data.holderEmail || data.holderEmail.trim().length === 0) {
    throw new Error('holderEmail must not be empty.');
  }

  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (!emailRegex.test(data.holderEmail.trim())) {
    throw new Error(`holderEmail is not a valid email address: "${data.holderEmail}".`);
  }

  const validTypes: AccreditationType[] = [
    'staff', 'press', 'artist', 'vip_host', 'volunteer', 'vendor', 'organizer',
  ];
  if (!validTypes.includes(data.accreditationType)) {
    throw new Error(`accreditationType "${data.accreditationType}" is not valid.`);
  }

  if (!data.zoneAccess || data.zoneAccess.length === 0) {
    throw new Error('zoneAccess must contain at least one zone ID.');
  }
}
