// ---------------------------------------------------------------------------
// Accreditation — shared domain types
// ---------------------------------------------------------------------------

export type AccreditationType =
  | 'staff'
  | 'press'
  | 'artist'
  | 'vip_host'
  | 'volunteer'
  | 'vendor'
  | 'organizer';

export type AccreditationStatus =
  | 'requested'
  | 'approved'
  | 'issued'
  | 'active'
  | 'rejected'
  | 'revoked';

export interface Accreditation {
  id: string;
  event_id: string;
  holder_name: string;
  holder_email: string;
  holder_phone: string | null;
  holder_organization: string | null;    // firma, médium, kapela
  accreditation_type: AccreditationType;
  role_description: string | null;       // konkrétní role: "Zvukař", "Fotograf ČTK"
  zone_access: string[];                 // IDs zón
  valid_days: string[] | null;           // null = celá akce; nebo ["2026-08-15", "2026-08-16"]
  status: AccreditationStatus;
  qr_code: string;                       // statický UUID-based kód
  badge_color: string;                   // hex barva dle typu
  photo_url: string | null;
  requested_by_user_id: string;
  approved_by_user_id: string | null;
  issued_at: Date | null;
  approved_at: Date | null;
  rejected_at: Date | null;
  revoked_at: Date | null;
  revocation_reason: string | null;
  notes: string | null;
  created_at: Date;
}

export interface AccreditationScanResult {
  allowed: boolean;
  accreditation_id: string;
  holder_name: string;
  accreditation_type: AccreditationType;
  badge_color: string;
  zone_name: string;
  valid_today: boolean;
  reason?: string;
}

// ---------------------------------------------------------------------------
// Typed errors
// ---------------------------------------------------------------------------

export class AccreditationNotFoundError extends Error {
  readonly code = 'ACCREDITATION_NOT_FOUND' as const;
  constructor(id: string) {
    super(`Accreditation not found: ${id}`);
    this.name = 'AccreditationNotFoundError';
  }
}

export class AccreditationNotActiveError extends Error {
  readonly code = 'ACCREDITATION_NOT_ACTIVE' as const;
  readonly status: AccreditationStatus;
  constructor(id: string, status: AccreditationStatus) {
    super(`Accreditation ${id} is not active (status: ${status})`);
    this.name = 'AccreditationNotActiveError';
    this.status = status;
  }
}

export class AccreditationRevokedError extends Error {
  readonly code = 'ACCREDITATION_REVOKED' as const;
  constructor(id: string) {
    super(`Accreditation has been revoked: ${id}`);
    this.name = 'AccreditationRevokedError';
  }
}

export class AccreditationZoneDeniedError extends Error {
  readonly code = 'ACCREDITATION_ZONE_DENIED' as const;
  constructor(id: string, zoneIds: string[]) {
    super(`Accreditation ${id} does not have access to zones: ${zoneIds.join(', ')}`);
    this.name = 'AccreditationZoneDeniedError';
  }
}

export class AccreditationInvalidDayError extends Error {
  readonly code = 'ACCREDITATION_INVALID_DAY' as const;
  constructor(id: string, date: string) {
    super(`Accreditation ${id} is not valid on ${date}`);
    this.name = 'AccreditationInvalidDayError';
  }
}

export class AccreditationUnauthorizedError extends Error {
  readonly code = 'ACCREDITATION_UNAUTHORIZED' as const;
  constructor(userId: string, eventId: string) {
    super(`User ${userId} is not authorized to manage accreditations for event ${eventId}`);
    this.name = 'AccreditationUnauthorizedError';
  }
}

export class AccreditationDuplicateError extends Error {
  readonly code = 'ACCREDITATION_DUPLICATE' as const;
  constructor(email: string, eventId: string) {
    super(`Accreditation for ${email} on event ${eventId} already exists`);
    this.name = 'AccreditationDuplicateError';
  }
}
