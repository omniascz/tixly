export type CookieCategory = 'necessary' | 'functional' | 'analytics' | 'marketing';

export interface ConsentRecord {
  id: string;
  promoterId: string;
  /** Anonymous visitor identifier — random UUID stored in cookie */
  visitorId: string;
  /** Map category → granted */
  consents: Record<CookieCategory, boolean>;
  /** IP for legal proof (consider hashing for GDPR) */
  ipHash: string | null;
  userAgent: string | null;
  /** Banner version when consent was given */
  bannerVersion: string;
  consentedAt: Date;
  /** Optional expiry — re-prompt after this */
  expiresAt: Date;
}

/** GDPR consent type — distinct from cookie categories for user consent tracking */
export type ConsentType = 'marketing' | 'analytics' | 'personalization' | 'functional';

/** GDPR consent status */
export type ConsentStatus = 'granted' | 'denied' | 'withdrawn';

/** Lawful basis for processing (GDPR Art. 6) */
export type LawfulBasis = 'consent' | 'legitimate_interest' | 'contract' | 'legal_obligation' | 'vital_interests' | 'public_task';

/**
 * User consent record for GDPR compliance.
 * Tracks per-consent-type status with audit trail.
 */
export interface Consent {
  id: string;
  userId: string;
  type: ConsentType;
  status: ConsentStatus;
  grantedAt: Date | null;
  withdrawnAt: Date | null;
  lawfulBasis: LawfulBasis;
  ipAddress: string | null;
  userAgent: string | null;
}

/**
 * Immutable audit trail entry for consent changes.
 * Used for GDPR documentation and compliance.
 */
export interface ConsentAudit {
  id: string;
  userId: string;
  consentId: string;
  action: 'granted' | 'withdrawn' | 'updated';
  timestamp: Date;
  ipAddress: string | null;
  reason: string | null;
}

export interface BannerConfig {
  promoterId: string;
  /** Banner copy in Czech */
  title: string;
  description: string;
  acceptAllLabel: string;
  rejectAllLabel: string;
  customizeLabel: string;
  /** Per-category descriptions */
  categories: Array<{
    key: CookieCategory;
    name: string;
    description: string;
    /** Required (necessary) → user can't disable */
    required: boolean;
    /** True by default (pre-checked) */
    defaultEnabled: boolean;
  }>;
  /** Banner version — increment to force re-consent */
  version: string;
  /** Privacy policy URL */
  privacyPolicyUrl: string;
}

export interface RecordConsentInput {
  promoterId: string;
  visitorId: string;
  consents: Partial<Record<CookieCategory, boolean>>;
  bannerVersion: string;
  ipHash?: string;
  userAgent?: string;
}
