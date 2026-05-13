export type AffiliateStatus = 'active' | 'suspended';
export type ConversionStatus = 'pending' | 'confirmed' | 'reversed';
export type PayoutStatus = 'pending' | 'processing' | 'paid' | 'failed';

export interface Affiliate {
  id: string;
  userId: string;
  promoterId: string;
  /** Komise v procentech × 100 (500 = 5.00 %) */
  commissionRateBps: number;
  /** Celkový zůstatek peněženky v haléřích */
  walletBalance: number;
  /** Minimální zůstatek pro výplatu v haléřích (default 50000 = 500 Kč) */
  payoutThreshold: number;
  status: AffiliateStatus;
  createdAt: Date;
}

export interface AffiliateLink {
  id: string;
  affiliateId: string;
  eventId: string | null;   // null = platí pro všechny akce promotéra
  code: string;             // base62, 8 znaků, unikátní
  clickCount: number;
  conversionCount: number;
  createdAt: Date;
}

export interface AffiliateClick {
  id: string;
  linkId: string;
  sessionId: string;        // anonymní session fingerprint
  referrer: string | null;
  createdAt: Date;
}

export interface AffiliateConversion {
  id: string;
  linkId: string;
  affiliateId: string;
  orderId: string;
  orderAmount: number;       // haléře
  commission: number;        // haléře = orderAmount × commissionRateBps / 10000
  status: ConversionStatus;
  createdAt: Date;
}

export interface AffiliatePayout {
  id: string;
  affiliateId: string;
  amount: number;            // haléře
  status: PayoutStatus;
  createdAt: Date;
}

// ---------------------------------------------------------------------------
// Chybové třídy
// ---------------------------------------------------------------------------
export class AffiliateLinkNotFoundError extends Error {
  constructor(msg: string) { super(msg); this.name = 'AffiliateLinkNotFoundError'; }
}
export class AffiliateNotActiveError extends Error {
  constructor(msg: string) { super(msg); this.name = 'AffiliateNotActiveError'; }
}
export class PayoutThresholdNotReachedError extends Error {
  readonly currentBalance: number;
  readonly threshold: number;
  constructor(msg: string, currentBalance: number, threshold: number) {
    super(msg);
    this.name = 'PayoutThresholdNotReachedError';
    this.currentBalance = currentBalance;
    this.threshold = threshold;
  }
}
export class DuplicateConversionError extends Error {
  constructor(msg: string) { super(msg); this.name = 'DuplicateConversionError'; }
}

// Název cookie pro affiliate tracking
export const AFFILIATE_COOKIE = 'tixly_aff';
export const AFFILIATE_COOKIE_TTL_DAYS = 30;
