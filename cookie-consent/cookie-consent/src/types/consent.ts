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
