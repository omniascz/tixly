// Resale marketplace — domain types
// Aligned with resale.resale_listings and resale.resale_watchlist schema

export type ResaleListingStatus =
  | 'active'
  | 'reserved'
  | 'sold'
  | 'cancelled'
  | 'expired';

// Escrow state machine:
//   none → held (GoPay AUTHORIZED)
//   held → captured (buyer claim + GoPay CAPTURE)
//   held → voided (claim timeout → GoPay void)
//   captured → released (payout to seller)
//   held | captured → refunded (event cancelled)
export type EscrowStatus =
  | 'none'
  | 'held'
  | 'captured'
  | 'released'
  | 'refunded'
  | 'voided';

export interface ResaleListing {
  id: string;
  ticketId: string;
  sellerId: string;
  buyerId: string | null;
  askPrice: number;
  originalPrice: number;
  /** Commission rate snapshot at listing creation time (e.g. 0.05 for 5%) */
  commissionRate: number;
  status: ResaleListingStatus;
  escrowStatus: EscrowStatus;
  /** GoPay preauthorization payment ID — internal, not exposed in public API */
  gopayPaymentId: string | null;
  listedAt: Date;
  expiresAt: Date | null;
  /** Reservation expires after 10 min; buyer must complete GoPay payment */
  reservedUntil: Date | null;
  soldAt: Date | null;
  cancelledAt: Date | null;
  /** Payout amount after commission deduction; set when escrow_status → released */
  payoutAmount: number | null;
  payoutAt: Date | null;
  /** Retry count for failed payouts; after 3 → manual_review = true */
  payoutRetryCount: number;
  manualReview: boolean;
}

/** Buyer-facing listing — omits internal fields (gopayPaymentId, commissionRate internals) */
export interface ResaleListingPublic {
  id: string;
  ticketId: string;
  askPrice: number;
  originalPrice: number;
  status: ResaleListingStatus;
  escrowStatus: EscrowStatus;
  listedAt: Date;
  expiresAt: Date | null;
  reservedUntil: Date | null;
  soldAt: Date | null;
  /** Zone/section derived from the underlying ticket_type */
  zone: string | null;
  eventId: string;
}

/** Seller creates a new resale listing */
export interface CreateListingRequest {
  ticketId: string;
  askPrice: number;
  /**
   * Optional explicit expiry timestamp. When omitted, createListing will
   * derive expiry from the event (event.date_start - 24h). Used by the
   * 1-click flow to pass a pre-computed value.
   */
  explicitExpiresAt?: Date;
}

/** Buyer initiates purchase of a specific listing */
export interface PurchaseListingRequest {
  listingId: string;
}

export interface WatchlistEntry {
  id: string;
  userId: string;
  eventId: string;
  /** Buyer is only interested if ask_price ≤ maxPrice; NULL = any price */
  maxPrice: number | null;
  /** Preferred zone/section; NULL = any zone */
  zone: string | null;
  createdAt: Date;
  notifiedAt: Date | null;
}

export interface ClaimResult {
  success: boolean;
  ticketId: string;
  /** True when new TOTP secret has been delivered to buyer device */
  newQRAvailable: boolean;
  errorCode?: 'CLAIM_WINDOW_EXPIRED' | 'TICKET_NOT_FOUND' | 'UNAUTHORIZED' | 'ALREADY_CLAIMED';
}

export interface PaginatedResponse<T> {
  data: T[];
  total: number;
  page: number;
  limit: number;
  hasMore: boolean;
}

// ---------------------------------------------------------------------------
// Adapter interfaces — injected into services, easy to mock in tests
// ---------------------------------------------------------------------------

export interface DbRow {
  [key: string]: unknown;
}

export type { DbAdapter } from '@tixly/db-adapter';
import type { DbAdapter } from '@tixly/db-adapter';

export interface RedisAdapter {
  get(key: string): Promise<string | null>;
  set(key: string, value: string, ttlSeconds: number): Promise<void>;
  del(key: string): Promise<void>;
}

export interface EventBusAdapter {
  publish(topic: string, payload: unknown): Promise<void>;
}

export interface GopayPreauthorizeResult {
  paymentId: string;
  redirectUrl: string;
}

export interface GopayAdapter {
  preauthorize(params: {
    amount: number;
    currency: string;
    orderId: string;
    description: string;
    returnUrl: string;
  }): Promise<GopayPreauthorizeResult>;
  capture(paymentId: string): Promise<void>;
  voidAuthorization(paymentId: string): Promise<void>;
  payout(params: { paymentId: string; iban: string; amount: number }): Promise<void>;
  verifyHmacSignature(payload: string, signature: string): boolean;
}

export interface PushNotificationAdapter {
  send(userId: string, message: { title: string; body: string; data?: Record<string, string> }): Promise<void>;
}
